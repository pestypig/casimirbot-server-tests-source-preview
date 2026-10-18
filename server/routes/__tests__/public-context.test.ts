import { describe, expect, it } from "vitest";
import { loadPublicBadgeCatalog, loadPublicBadgeSearchText } from "../../services/public-context/catalog";
import { findPublicExploratoryCandidates, findPublicPrincipleHypotheses,
  findPublicQuestionAnchoredCandidates } from "../../services/public-context/principle-hypotheses";
import { reflectPublicContext } from "../../services/public-context/reflections";
import express from "express";
import request from "supertest";
import { createPublicBadgeCatalogRouter, createPublicContextMcpRouter } from "../public-context";

describe("public context", () => {
  it("fails closed before publication review", async () => {
    const app = express();
    app.use(createPublicBadgeCatalogRouter(() => false));
    app.use("/mcp/public-context", createPublicContextMcpRouter(() => false));
    app.get("/desktop", (_req, res) => res.type("html").send("<script src=/assets/app.js></script>"));
    await request(app).get("/context/badges").expect(404);
    await request(app).post("/mcp/public-context").send({}).expect(404);
    await request(app).get("/mcp/public-context").set("Accept", "text/html").expect(404);
    const desktop = await request(app).get("/desktop").expect(200);
    expect(desktop.headers["content-security-policy"]).toBeUndefined();
    expect(desktop.text).toContain("/assets/app.js");
  });
  it("serves page discovery while keeping MCP GET in the stateless transport", async () => {
    const app = express();
    app.use("/mcp/public-context", createPublicContextMcpRouter(() => true));
    const page = await request(app).get("/mcp/public-context").set("Accept", "text/html").expect(200);
    expect(page.headers["content-type"]).toMatch(/^text\/html/);
    expect(page.headers["cache-control"]).toBe("public, max-age=300");
    expect(page.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(page.headers.vary).toMatch(/Accept/);
    expect(page.text).toContain("casimir_theory_badges_reflect");
    expect(page.text).toContain("casimir_civilization_bounds_reflect");
    expect(page.text).toContain("casimir_moral_graph_reflect");
    expect(page.text).toContain("The host chooses when a reflection would help");
    expect(page.text).toContain("ignore unrelated cards");
    expect(page.text).toContain("/context/badges");
    await request(app).get("/mcp/public-context").set("Accept", "text/event-stream").expect(405);
    await request(app).get("/mcp/public-context")
      .set("Accept", "text/html, text/event-stream").expect(405);
    await request(app).get("/mcp/public-context")
      .set("Accept", "text/html").set("MCP-Protocol-Version", "2025-06-18").expect(405);
  });
  it("keeps catalog security headers scoped to catalog pages", async () => {
    const app = express();
    app.use(createPublicBadgeCatalogRouter(() => true));
    app.get("/desktop", (_req, res) => res.type("html").send("<script src=/assets/app.js></script>"));
    expect((await request(app).get("/context/badges").expect(200)).headers["content-security-policy"])
      .toContain("default-src 'none'");
    expect((await request(app).get("/desktop").expect(200)).headers["content-security-policy"])
      .toBeUndefined();
  });
  it("exposes concept projections without private payloads", async () => {
    const catalog = await loadPublicBadgeCatalog();
    expect(catalog.civilization.length).toBeGreaterThan(0);
    expect(catalog.theory.length).toBeGreaterThan(0);
    expect(catalog.moral.length).toBeGreaterThan(0);
    expect(JSON.stringify(catalog)).not.toMatch(/calculatorPayloads|access_token/);
    const unsourcedStudy = catalog.theory.find((badge) => badge.id === "study.casimir_dp.identifiability_redesign_stage4_2c");
    expect(unsourcedStudy?.source_refs).toEqual([]);
    expect(unsourcedStudy?.summary).not.toMatch(/certified|certificate/i);
  });

  it("renders every disclosed badge detail with uncertainty and claim boundaries", async () => {
    const app = express();
    app.use(createPublicBadgeCatalogRouter(() => true));
    const catalog = await loadPublicBadgeCatalog();
    const badges = (["civilization", "theory", "moral"] as const)
      .flatMap((lens) => catalog[lens].map((badge) => ({ lens, badge })));
    expect(badges).toHaveLength(752);
    for (let offset = 0; offset < badges.length; offset += 20) {
      await Promise.all(badges.slice(offset, offset + 20).map(async ({ lens, badge }) => {
        const detail = await request(app)
          .get(`/context/badges/${lens}/${encodeURIComponent(badge.id)}`).expect(200);
        expect(detail.text).toContain("<h2>Uncertainty</h2>");
        expect(detail.text).toContain("<h2>Sources</h2>");
        expect(detail.text).toContain("<h2>Claim boundaries</h2>");
        if (!badge.source_refs.length) expect(detail.text).toContain("No public source reference is attached");
      }));
    }
  }, 180_000);

  it("returns nonterminal observations for all three lenses", async () => {
    const prompts = [
      ["civilization", "Would a regional energy corridor improve society?"],
      ["theory", "What evidence would support a Casimir cavity theory?"],
      ["moral", "How should a society account for the welfare of living organisms?"],
    ] as const;
    for (const [lens, question] of prompts) {
      const result = await reflectPublicContext(lens, question);
      expect(result).toMatchObject({ lens, terminal_eligible: false, assistant_answer: false });
      expect(result.claim_boundaries.length).toBeGreaterThan(0);
      for (const badge of [...result.exact_badges, ...result.likely_badges]) {
        expect(badge.url).toMatch(/^https:\/\/[^/]+\/context\/badges\//);
      }
    }
  });

  it("omits generic energy matches from public theory context while retaining specific physics matches", async () => {
    const civic = await reflectPublicContext("theory",
      "A city is considering an energy corridor. How should society evaluate the decision?");
    expect(civic.exact_badges).toEqual([]);
    expect(civic.likely_badges).toEqual([]);
    expect(civic.summary).toContain("No sufficiently specific");
    expect(civic.terminal_eligible).toBe(false);

    const physics = await reflectPublicContext("theory",
      "What evidence would support a Casimir cavity theory?");
    expect(physics.likely_badges.some((badge) => badge.id.startsWith("casimir.cavity."))).toBe(true);
    expect(physics.missing_evidence).toContainEqual(expect.stringContaining("no public source reference"));
    expect(physics.assistant_answer).toBe(false);
  });

  it("locates the public Pauli badge for the short spatial-overlap question", async () => {
    const question = "Can fermions and bosons occupy the same space?";
    const result = await reflectPublicContext("theory", question);
    expect(result.likely_badges.map((badge) => badge.id)).toContain("physics.atomic.pauli_shell_structure");
    expect(result.source_refs).toContain("https://openstax.org/books/university-physics-volume-3/pages/11-1-introduction-to-particle-physics");
    expect(result.claim_boundaries.join(" ")).toMatch(/spatial overlap.*complete quantum state/i);
    expect(result.match_status).toBe("matched");
    const pauliCard = result.context_cards.find((card) => card.id === "physics.atomic.pauli_shell_structure");
    expect(pauliCard?.concept).toMatch(/identical fermions.*complete quantum state/i);
    expect(pauliCard?.reference_urls).toContain("https://openstax.org/books/university-physics-volume-3/pages/11-1-introduction-to-particle-physics");
    expect(pauliCard?.reference_context).toEqual([
      expect.objectContaining({ url: "https://openstax.org/books/university-physics-volume-3/pages/11-1-introduction-to-particle-physics", supports: expect.stringMatching(/one quantum-mechanical state/i) }),
      expect.objectContaining({ url: "https://openstax.org/books/chemistry-atoms-first-2e/pages/3-3-development-of-quantum-theory", supports: expect.stringMatching(/spin quantum numbers differ/i) }),
    ]);
    expect(pauliCard?.reference_status).toBe("some_scope_annotated");
    expect(result).toMatchObject({ terminal_eligible: false, assistant_answer: false });
    const quotedTerm = await reflectPublicContext("theory", "Can fermions and bosons occupy the 'same space'?");
    expect(quotedTerm.likely_badges.map((candidate) => candidate.id)).toContain("physics.atomic.pauli_shell_structure");

    const badge = (await loadPublicBadgeCatalog()).theory.find((entry) => entry.id === "physics.atomic.pauli_shell_structure");
    expect(badge?.summary).toMatch(/identical fermions.*complete quantum state/i);
    expect(badge?.summary).toMatch(/spatial orbital.*spin states differ/i);
    expect(badge?.uncertainty.length).toBeGreaterThan(0);
    const app = express();
    app.use(createPublicBadgeCatalogRouter(() => true));
    const detail = await request(app).get("/context/badges/theory/physics.atomic.pauli_shell_structure").expect(200);
    expect(detail.text).toContain("<h2>Uncertainty</h2>");
    expect(detail.text).toContain('<a href="https://openstax.org/books/university-physics-volume-3/pages/11-1-introduction-to-particle-physics">');
  });

  it("ranks the shared-mechanism boundary above numeric dark-matter context and ignores quoted source text", async () => {
    const question = "Does calling two dark-matter candidates bosonic prove that a xenon signal and a gamma-ray feature have one shared mechanism?";
    const result = await reflectPublicContext("theory", question);
    expect(result.context_cards[0]?.id).toBe("darkmatter.bosonic_multichannel.compatibility_screen");
    expect(result.context_cards[0]?.reference_status).toBe("catalog_pointer_only");
    expect(result.context_cards[0]?.concept).toMatch(/separate fits do not establish a shared origin/i);
    expect(result.context_cards[0]?.concept).not.toMatch(/10\s*\^?\s*-?17|1e-17/i);
    expect(result.context_cards[0]?.reference_context.every((ref) =>
      /claim-specific support has not been verified/.test(ref.supports))).toBe(true);
    const quoted = await reflectPublicContext("theory", `The page quotes "${question}" How do I bake bread?`);
    expect(quoted.match_status).toBe("no_match");
    expect(quoted.context_cards).toEqual([]);
  });

  it("exposes the source-backed energy screen only for the named boson-star and LZ benchmark", async () => {
    const result = await reflectPublicContext("theory",
      "Can the same free bosonic dark-matter field in the roughly 10^-17 eV Sgr A* boson-star benchmark also produce the LZ 248-keV xenon nuclear recoil through ordinary elastic scattering?");
    expect(result.context_cards.map((card) => card.id)).toEqual(["darkmatter.bosonic_multichannel.compatibility_screen"]);
    expect(result.context_cards[0].concept).toContain("5×10^-24 eV");
    expect(result.context_cards[0].reference_status).toBe("scope_annotated");
    expect(result.context_cards[0].concept).toContain("10^-51 eV");
    expect(result.context_cards[0].concept).toContain("1.5×10^56 times this recoil bound");
    expect(result.context_cards[0].concept).toContain("not a dark-matter discovery");
    expect(result.summary).toContain("not an observation of Sgr A*");
    expect(result.claim_boundaries).toContain("The Sgr A* boson-star benchmark is an illustrative model, not an observation that Sgr A* is a boson star.");
    expect(result.context_cards[0].reference_urls).toEqual([
      "https://arxiv.org/html/1809.08682v3",
      "https://arxiv.org/abs/2609.02823",
      "https://journals.aps.org/prd/abstract/10.1103/PhysRevD.107.093009",
    ]);
    expect(result.context_cards[0].reference_context).toEqual([
      expect.objectContaining({ url: "https://arxiv.org/html/1809.08682v3", supports: expect.stringContaining("not evidence") }),
      expect.objectContaining({ url: "https://arxiv.org/abs/2609.02823", supports: expect.stringContaining("not a dark-matter discovery") }),
      expect.objectContaining({ url: "https://journals.aps.org/prd/abstract/10.1103/PhysRevD.107.093009", supports: expect.stringContaining("2 μ²v²/m_N") }),
    ]);
  });

  it("locates a target-specific elastic recoil bound without importing the xenon benchmark", async () => {
    for (const question of [
      "A proposed argon detector event deposits 5 keV of nuclear recoil energy. Could one free 10^-16 eV bosonic dark-matter quantum moving at 10^-3 c cause it through ordinary two-body elastic scattering? What remains open?",
      "A team asks whether a free 1 MeV dark-matter particle at 10^-3 c could produce a 1-keV silicon nuclear recoil in one ordinary elastic collision. What calculation and caveats matter?",
    ]) {
      const result = await reflectPublicContext("theory", question);
      expect(result.context_cards[0]?.id).toBe("physics.scattering.elastic_nuclear_recoil_bound");
      expect(result.context_cards[0]?.concept).toContain("2 μ²v²/m_N");
      expect(result.context_cards[0]?.concept).not.toMatch(/LZ|Sgr A\*|xenon recoil bound/i);
      expect(result.context_cards[0]?.reference_context).toEqual([
        expect.objectContaining({ url: "https://journals.aps.org/prd/abstract/10.1103/PhysRevD.107.093009", supports: expect.stringContaining("target nuclear mass") }),
        expect.objectContaining({ url: "https://physics.nist.gov/cuu/pdf/all.pdf", supports: expect.stringContaining("931.494 MeV") }),
        expect.objectContaining({ url: "https://ciaaw.org/atomic-weights.htm", supports: expect.stringContaining("standard atomic weights") }),
      ]);
      expect(result.claim_boundaries).toContainEqual(expect.stringContaining("target-specific elastic endpoint"));
    }
    const badge = (await loadPublicBadgeCatalog()).theory.find((entry) =>
      entry.id === "physics.scattering.elastic_nuclear_recoil_bound");
    expect(badge?.status).toBe("public diagnostic concept");
    expect(badge?.source_refs).toEqual(["https://journals.aps.org/prd/abstract/10.1103/PhysRevD.107.093009"]);
    for (const inactive of [
      'The page quotes "A free bosonic particle caused an elastic nuclear recoil in argon." How do I clean a muddy bicycle chain?',
      "Do not discuss elastic nuclear recoils. How do I steep black tea?",
      "I am not asking about elastic nuclear recoil from a boson in argon. How do I bake bread?",
    ]) {
      expect((await reflectPublicContext("theory", inactive)).match_status).toBe("no_match");
    }
  });

  it("separates measured Casimir force from an assessed cyclic energy claim", async () => {
    const question = "Could a Casimir cavity energy project benefit society while protecting living organisms?";
    const result = await reflectPublicContext("theory", question);
    expect(result.context_cards.map((candidate) => candidate.id)).toEqual(["casimir.cavity.parallel_plate_energy_density"]);
    const card = result.context_cards.find((candidate) =>
      candidate.id === "casimir.cavity.parallel_plate_energy_density");
    expect(card).toBeDefined();
    expect(card?.reference_context).toEqual([
      expect.objectContaining({ url: "https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.78.5", supports: expect.stringContaining("not evidence of net energy") }),
      expect.objectContaining({ url: "https://arxiv.org/abs/0910.5893", supports: expect.stringContaining("does not settle every proposed use") }),
    ]);
    expect(card?.claim_boundaries).toContain("A static Casimir energy-per-area calculation does not establish repeatable net useful power or a viable energy project.");
    const social = await reflectPublicContext("civilization", question);
    expect(social.summary).toMatch(/test net output/i);
    expect(social.context_cards.map((candidate) => candidate.id)).toEqual(["energy_capacity", "governance", "falsification"]);
    expect(social.context_cards.every((card) => card.reference_status === "no_public_reference")).toBe(true);
    expect(social.missing_evidence).toContainEqual(expect.stringContaining("stop criteria"));
    expect(social.missing_evidence).toContainEqual(expect.stringContaining("do not substitute it for the energy project"));
    expect(social.claim_boundaries).toContainEqual(expect.stringContaining("does not establish net useful power"));
    for (const active of [
      "If a future Casimir cavity energy project is proposed, what evidence could justify a societal benefit?",
      "Last year's Casimir cavity energy project claimed a societal benefit. What evidence was missing?",
    ]) {
      expect((await reflectPublicContext("civilization", active)).summary).toMatch(/test net output/i);
      expect((await reflectPublicContext("theory", active)).context_cards.map((candidate) => candidate.id))
        .toEqual(["casimir.cavity.parallel_plate_energy_density"]);
    }
    for (const inactive of [
      'The page quotes "Casimir cavity energy project". How do I bake bread?',
      "Do not discuss a Casimir cavity energy project. How do I bake bread?",
    ]) {
      expect((await reflectPublicContext("civilization", inactive)).match_status).toBe("no_match");
      expect((await reflectPublicContext("theory", inactive)).match_status).toBe("no_match");
    }
    const distinctTopics = "What does Casimir cavity mode frequency mean, and how should a city budget its energy purchases?";
    expect((await reflectPublicContext("civilization", distinctTopics)).summary).not.toContain("Casimir cavity energy project");
    expect((await reflectPublicContext("theory", distinctTopics)).context_cards.map((candidate) => candidate.id))
      .not.toEqual(["casimir.cavity.parallel_plate_energy_density"]);
  });

  it("abstains instead of framing an unrelated bread recipe as civilization or moral context", async () => {
    for (const lens of ["civilization", "moral"] as const) {
      const result = await reflectPublicContext(lens, "How do I bake a loaf of bread?");
      expect(result.match_status).toBe("no_match");
      expect(result.exact_badges).toEqual([]);
      expect(result.likely_badges).toEqual([]);
      expect(result.context_cards).toEqual([]);
      expect(JSON.stringify(result)).not.toMatch(/planetary trade|spore|input_refs|deterministic_ideology_lens_match/i);
    }
    const collective = await reflectPublicContext("civilization", "How can a city keep bread available during a supply shortage?");
    expect(collective.match_status).toBe("matched");
    expect(collective.context_cards.length).toBeGreaterThan(0);
    const town = await reflectPublicContext("civilization",
      "A town wants to keep grocery cold storage running during a seven-day grid outage. What must it measure before calling the plan resilient?");
    expect(town.match_status).toBe("matched");
    expect(town.context_cards.length).toBeGreaterThan(0);
    expect(town.summary).toMatch(/collective capacity/i);
    expect(town.missing_evidence).toContainEqual(expect.stringContaining("critical service load"));
    expect(town.claim_boundaries).not.toContainEqual(expect.stringMatching(/Spore|planetary trade/i));
    for (const question of [
      'The page quotes "society"; how do I bake a loaf of bread?',
      'The page quotes "A technology project could benefit society while protecting living organisms"; how do I bake a loaf of bread?',
      "Do not discuss society; how do I bake a loaf of bread?",
      "Do not discuss whether a technology project benefits society or protects living organisms. How do I bake a loaf of bread?",
      'The screen shows a "civilization" badge; how do I bake bread?',
    ]) {
      expect((await reflectPublicContext("civilization", question)).match_status).toBe("no_match");
    }
  });

  it("prioritizes habitat evidence for a public corridor question without treating quoted wildlife text as the topic", async () => {
    const result = await reflectPublicContext("civilization",
      "Would a regional energy corridor improve society if it also cuts through wildlife habitat?");
    expect(result.context_cards[0]?.id).toBe("ecological_boundary");
    expect(result.context_cards[0]?.reference_context).toEqual([
      expect.objectContaining({ url: expect.stringContaining("usgs.gov"), supports: expect.stringContaining("connectivity") }),
    ]);
    expect(result.source_refs).not.toContain("https://www.fws.gov/node/266176");
    expect(result.source_refs).not.toContain("https://www.energy.gov/nepa/articles/interim-guidance-nepa-reviews-electric-transmission-projects-january-2025");
    const electric = await reflectPublicContext("civilization",
      "Would an electric transmission corridor improve society if it cuts through wildlife habitat?");
    expect(electric.context_cards[0]?.reference_context).toEqual([
      expect.objectContaining({ url: expect.stringContaining("usgs.gov"), supports: expect.stringContaining("connectivity") }),
      expect.objectContaining({ url: "https://www.fws.gov/node/266176", supports: expect.stringContaining("Electric transmission lines") }),
      expect.objectContaining({ url: expect.stringContaining("energy.gov"), supports: expect.stringContaining("electric-line NEPA review") }),
    ]);
    const batteryWetland = await reflectPublicContext("civilization",
      "A region proposes a battery depot to keep hospitals powered during outages, but construction would replace a wetland. What should it establish about technical feasibility, community reliability, and harm to species before deciding?");
    expect(batteryWetland.context_cards[0]?.id).toBe("ecological_boundary");
    expect(batteryWetland.context_cards[0]?.reference_context).toEqual([
      expect.objectContaining({ url: expect.stringContaining("usgs.gov"), supports: expect.stringContaining("connectivity") }),
      expect.objectContaining({ url: "https://www.epa.gov/wetlands/basic-information-about-wetland-restoration-and-protection", supports: expect.stringContaining("wetland") }),
    ]);
    expect(batteryWetland.source_refs).not.toContain("https://www.fws.gov/node/266176");
    expect(batteryWetland.source_refs).not.toContain("https://www.energy.gov/nepa/articles/interim-guidance-nepa-reviews-electric-transmission-projects-january-2025");
    expect(result.missing_evidence).toContainEqual(expect.stringContaining("corridor type"));
    expect(result.missing_evidence).toContainEqual(expect.stringContaining("disconfirm the proposed benefit"));
    const quoted = await reflectPublicContext("civilization",
      'The page quotes "energy corridor through wildlife habitat". How should society arrange a book club?');
    expect([...quoted.exact_badges, ...quoted.likely_badges].map((badge) => badge.id)).not.toContain("ecological_boundary");
  });

  it("does not promote the broad society tag into an unrelated moral context card", async () => {
    const result = await reflectPublicContext("moral", "How should a society account for the welfare of living organisms?");
    expect(result.match_status).toBe("matched");
    expect(result.context_cards.map((card) => card.id)).not.toContain("citizens-arc");
    expect(result.context_cards.some((card) => card.id.startsWith("substrate."))).toBe(true);
  });

  it("focuses a severe animal-harm tradeoff on the harm-weighted moral lens", async () => {
    const result = await reflectPublicContext("moral",
      "A conservation fund can protect either a large common habitat or a smaller habitat containing animals at high risk of severe harm. What should decision makers check before claiming the larger aggregate benefit settles the choice?");
    expect(result.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect(result.missing_evidence).toContainEqual(expect.stringContaining("severity and duration"));
    expect(result.claim_boundaries).toContainEqual(expect.stringContaining("no universal threshold"));
  });

  it("scopes shelter welfare and flood-wetland evidence to the active question", async () => {
    const shelter = await reflectPublicContext("moral",
      "An animal shelter says admitting more animals creates a greater aggregate benefit even if a smaller group suffers prolonged distress. What should it measure before treating the headcount as morally decisive?");
    expect(shelter.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect(shelter.context_cards[0].reference_context).toEqual([
      expect.objectContaining({ url: expect.stringContaining("jsmcah.org"), supports: expect.stringContaining("do not choose the moral weights") }),
    ]);
    expect(shelter.missing_evidence).toContainEqual(expect.stringContaining("post-admission health"));
    const question = "A county proposes a flood-control levee through a wetland, protecting homes but disrupting migratory birds. What should it establish about engineering performance, residents, and habitat harm before calling the project net beneficial?";
    const civic = await reflectPublicContext("civilization", question);
    expect(civic.context_cards[0]?.id).toBe("ecological_boundary");
    expect(civic.source_refs).toEqual(expect.arrayContaining([
      "https://usace-leveesafety.sec.usace.army.mil/",
      "https://www.epa.gov/wetlands/basic-information-about-wetland-restoration-and-protection",
    ]));
    expect(civic.source_refs).not.toContain("https://www.fws.gov/node/266176");
    expect(civic.missing_evidence).toContainEqual(expect.stringContaining("final decision authority"));
    const moral = await reflectPublicContext("moral", question);
    expect(moral.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect(moral.missing_evidence).toContainEqual(expect.stringContaining("which value rule"));
    const quoted = 'The page quotes "A county proposes a flood-control levee through a wetland." How do I clean a muddy bicycle chain?';
    expect((await reflectPublicContext("civilization", quoted)).match_status).toBe("no_match");
    expect((await reflectPublicContext("moral", quoted)).match_status).toBe("no_match");
  });

  it("recognizes adoption and companion-animal welfare without importing quoted or negated text", async () => {
    const question = "A humane society reports more adoptions after expanding intake, but dogs remaining in care show chronic distress. Should its board count this as progress?";
    const welfare = await reflectPublicContext("moral", question);
    expect(welfare.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect([...welfare.exact_badges, ...welfare.likely_badges].map((badge) => badge.id)).toEqual(["harm-weighted-priority-standard"]);
    expect(welfare.source_refs).toContain("https://jsmcah.org/index.php/jasv/article/download/42/20/182?inline=1");
    expect(welfare.missing_evidence).toContainEqual(expect.stringContaining("unacceptable-harm thresholds"));
    expect(welfare.claim_boundaries).toContainEqual(expect.stringContaining("not by itself an overall success-or-failure verdict"));
    expect((await reflectPublicContext("civilization", question)).match_status).toBe("no_match");
    expect((await reflectPublicContext("civilization", "How should a city fund the humane society while maintaining public animal services?")).match_status).toBe("matched");
    const quoted = 'The screen says "Dogs remaining in care show distress after more adoptions." How do I clean a muddy bicycle chain?';
    expect((await reflectPublicContext("moral", quoted)).match_status).toBe("no_match");
    const negated = "Do not discuss dog distress or adoptions. How do I clean a muddy bicycle chain?";
    expect((await reflectPublicContext("moral", negated)).match_status).toBe("no_match");
    const apostropheInQuote = "The screen shows \"An adoption charity's placements rose while kennel animals became anxious.\" How do I clean a muddy bicycle chain?";
    expect((await reflectPublicContext("moral", apostropheInQuote)).match_status).toBe("no_match");
    expect((await reflectPublicContext("civilization", apostropheInQuote)).match_status).toBe("no_match");
  });

  it("retrieves welfare and marsh context for paraphrases while excluding quoted instructions", async () => {
    const rescue = await reflectPublicContext("moral",
      "An animal rescue's board wants to boast that higher intake proves success, although a small group of long-term residents shows severe stress. What outcomes and moral assumptions should it examine?");
    expect(rescue.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect(rescue.source_refs).toContain("https://jsmcah.org/index.php/jasv/article/download/42/20/182?inline=1");
    expect(rescue.missing_evidence).toContainEqual(expect.stringContaining("unacceptable-harm thresholds"));
    const question = "A coastal town proposes an elevated evacuation road across a marsh to reduce storm isolation, but it would harm nesting birds. What should it establish before claiming the road improves safety overall?";
    const civic = await reflectPublicContext("civilization", question);
    expect(civic.context_cards[0]?.id).toBe("ecological_boundary");
    expect(civic.source_refs).toContain("https://www.epa.gov/wetlands/basic-information-about-wetland-restoration-and-protection");
    expect(civic.missing_evidence).toContainEqual(expect.stringContaining("final decision authority"));
    const moral = await reflectPublicContext("moral", question);
    expect(moral.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    const quoted = 'The screen shows "An elevated evacuation road would harm nesting birds." How do I clean a muddy bicycle chain?';
    expect((await reflectPublicContext("civilization", quoted)).match_status).toBe("no_match");
    expect((await reflectPublicContext("moral", quoted)).match_status).toBe("no_match");
  });

  it("keeps aggregate animal output separate from welfare and value judgments", async () => {
    for (const question of [
      "If an ecosystem's total output rises while individual animals suffer, what should a decision maker check before claiming the project is good?",
      "If a future ecosystem project raises output while animals suffer, how should its benefits be weighed?",
      "Last year's ecosystem project increased output while animals suffered. How should the decision be reviewed?",
    ]) {
      const result = await reflectPublicContext("moral", question);
      expect(result.context_cards[0]?.id).toBe("harm-weighted-priority-standard");
      expect(result.context_cards.map((card) => card.id)).not.toContain("substrate.actuation-before-agency");
      expect(result.missing_evidence).toContainEqual(expect.stringContaining("causal contribution"));
      expect(result.missing_evidence).not.toContain("Identify a relevant Moral Graph lens before applying its claims to this question.");
      expect(result.uncertainty).toContainEqual(expect.stringContaining("value judgment"));
      expect(result.claim_boundaries).toContainEqual(expect.stringContaining("no universal threshold"));
    }
    for (const question of [
      'The page quotes "ecosystem output rises while animals suffer". How do I bake bread?',
      "Do not discuss ecosystem output or animals suffering. How do I bake bread?",
      'The screen shows "ecosystem output rises while animals suffer". How do I bake bread?',
    ]) {
      expect((await reflectPublicContext("moral", question)).match_status).toBe("no_match");
    }
    const agency = await reflectPublicContext("moral", "Does output from a living system establish moral agency?");
    expect([...agency.exact_badges, ...agency.likely_badges].map((badge) => badge.id))
      .toContain("substrate.actuation-before-agency");
  });

  it("maps wildlife mitigation procedure without treating it as moral authority", async () => {
    const url = "https://www.fws.gov/policy-library/501fw2";
    for (const question of [
      "How should a society weigh an energy corridor's benefits against harm to wildlife?",
      "If a future energy corridor harms wildlife, what should a society weigh?",
      "Last year's energy corridor harmed wildlife. What should society weigh now?",
    ]) {
      const result = await reflectPublicContext("moral", question);
      expect(result.context_cards[0]?.id).toBe("harm-weighted-priority-standard");
      expect(result.context_cards).toHaveLength(1);
      expect(result.summary).toContain("distinguish those observations from chosen value weights");
      expect(result.context_cards[0]?.concept).toContain("does not decide approval");
      expect(result.context_cards[0]?.reference_context).toEqual([
        expect.objectContaining({ url, supports: expect.stringContaining("does not support community value weights") }),
      ]);
      expect(result.claim_boundaries).toContainEqual(expect.stringContaining("never for community value weights"));
      expect(result.claim_boundaries).toContainEqual(expect.stringContaining("does not itself set a universal approval or rejection threshold"));
      expect(result.missing_evidence).toContainEqual(expect.stringContaining("funded repair"));
      expect(result.missing_evidence).toContainEqual(expect.stringContaining("independent source references"));
      expect(result.missing_evidence).not.toContain("input_refs");
    }
    for (const question of [
      'The page quotes "energy corridor harming wildlife". How should a society arrange a book club?',
      "Do not discuss an energy corridor harming wildlife; how should a society organize a book club?",
      'The screen shows "energy corridor harming wildlife". How should a society arrange a book club?',
    ]) {
      const result = await reflectPublicContext("moral", question);
      expect(result.match_status).toBe("no_match");
      expect(result.source_refs).not.toContain(url);
    }
  });

  it("focuses a target-specific elastic recoil question without importing the boson benchmark", async () => {
    const result = await reflectPublicContext("theory",
      "Could a free 10^-12 eV boson at an ordinary galactic speed produce a 30-keV germanium nuclear recoil by two-body elastic scattering?");
    expect(result.context_cards.map((card) => card.id)).toEqual(["physics.scattering.elastic_nuclear_recoil_bound"]);
    expect(result.source_refs).toContain("https://journals.aps.org/prd/abstract/10.1103/PhysRevD.107.093009");
    expect(result.source_refs).not.toContain("https://arxiv.org/abs/2609.02823");
    expect(result.missing_evidence).toContainEqual(expect.stringContaining("target nuclear mass"));
    for (const question of [
      'The page quotes "a boson causes an elastic germanium nuclear recoil". How do I repair a bicycle chain?',
      "Do not discuss a boson causing an elastic germanium nuclear recoil. How do I repair a bicycle chain?",
    ]) {
      expect((await reflectPublicContext("theory", question)).context_cards.map((card) => card.id))
        .not.toContain("physics.scattering.elastic_nuclear_recoil_bound");
    }
  });

  it("scopes utility, hospital, and fish-passage references to their active questions", async () => {
    const utility = await reflectPublicContext("civilization",
      "A small town's drinking-water pumps face a five-day power outage. What evidence should its utility check before promising continuous service?");
    expect(utility.context_cards.map((card) => card.id)).toContain("energy_capacity");
    expect(utility.source_refs).toContain("https://www.epa.gov/waterresilience/power-resilience-guide-water-and-wastewater-utilities");
    expect(utility.missing_evidence).toContainEqual(expect.stringContaining("water-quality limits"));
    const wastewater = await reflectPublicContext("civilization",
      "A district says one generator will keep its wastewater lift stations operating through a 72-hour grid failure. What must it check before residents rely on that promise?");
    expect(wastewater.match_status).toBe("matched");
    expect(wastewater.context_cards.map((card) => card.id)).toContain("energy_capacity");
    expect(wastewater.source_refs).toContain("https://www.epa.gov/waterresilience/power-resilience-guide-water-and-wastewater-utilities");

    const hospital = await reflectPublicContext("moral",
      "A hospital improves patient throughput, but a small group has prolonged pain from delayed care. What should its board weigh?");
    expect(hospital.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect(hospital.source_refs).toContain("https://www.who.int/news-room/fact-sheets/detail/quality-health-services");
    expect(hospital.missing_evidence).toContainEqual(expect.stringContaining("pain severity"));
    expect(hospital.claim_boundaries).toContainEqual(expect.stringContaining("clinical standard"));

    const floodgate = "A county floodgate protects low-income homes but may interrupt a migratory fish run. What evidence and value judgments matter before approval?";
    const civic = await reflectPublicContext("civilization", floodgate);
    const moral = await reflectPublicContext("moral", floodgate);
    expect(civic.context_cards[0]?.id).toBe("ecological_boundary");
    expect(civic.source_refs).toContain("https://www.fisheries.noaa.gov/national/habitat-conservation/reopening-rivers-migratory-fish");
    expect(civic.source_refs).not.toContain("https://www.preptoolkit.fema.gov/web/em-toolkits/large-scale-population-movement-and-resettlement");
    expect(civic.missing_evidence).toContainEqual(expect.stringContaining("shifted risk"));
    expect(moral.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect(moral.source_refs).toContain("https://www.fisheries.noaa.gov/national/habitat-conservation/reopening-rivers-migratory-fish");
    expect(moral.claim_boundaries).toContainEqual(expect.stringContaining("value assigned to fish harm"));
    for (const question of [
      'The page quotes "A county floodgate interrupts migratory fish". How do I repair a bicycle chain?',
      "Do not discuss a floodgate or migratory fish. How do I repair a bicycle chain?",
    ]) {
      expect((await reflectPublicContext("civilization", question)).match_status).toBe("no_match");
      expect((await reflectPublicContext("moral", question)).match_status).toBe("no_match");
    }
  });

  it("focuses emergency communications power, clinical delay, and closed fish passage", async () => {
    const radio = await reflectPublicContext("civilization",
      "A county installs solar panels and a battery for its emergency radio network and promises every community uninterrupted coverage for 72 hours after a hurricane. What evidence should it publish?");
    expect(radio.context_cards[0]?.id).toBe("energy_capacity");
    expect(radio.source_refs).toContain("https://www.energy.gov/cmei/femp/articles/battery-energy-storage-system-evaluation-method");
    expect(radio.missing_evidence).toContainEqual(expect.stringContaining("end-to-end communications coverage"));
    const dispatch = await reflectPublicContext("civilization",
      "A public-safety dispatch network relies on a backup battery during a storm outage. Could it keep remote neighborhoods served for two days?");
    expect(dispatch.context_cards[0]?.id).toBe("energy_capacity");
    expect((await reflectPublicContext("civilization",
      'The screen quotes "emergency radio battery outage." How do I replace a bicycle inner tube?')).match_status).toBe("no_match");
    expect((await reflectPublicContext("civilization",
      "Do not discuss an emergency radio battery outage. How do I replace a bicycle inner tube?")).match_status).toBe("no_match");

    const urgentCare = await reflectPublicContext("moral",
      "An urgent-care network doubles virtual appointments, but rural patients with severe symptoms wait longer for an in-person examination. Has access improved?");
    expect(urgentCare.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect(urgentCare.source_refs).toContain("https://www.who.int/news-room/fact-sheets/detail/quality-health-services");
    expect(urgentCare.missing_evidence).toContainEqual(expect.stringContaining("referral capacity"));
    const clinic = await reflectPublicContext("moral",
      "A clinic adds more video visits while seriously ill patients face longer waits for direct care. Is that an access gain?");
    expect(clinic.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect((await reflectPublicContext("moral",
      'The page quotes "urgent-care patients wait for appointments." How do I replace a bicycle inner tube?')).match_status).toBe("no_match");
    expect((await reflectPublicContext("moral",
      "Do not discuss urgent-care patient delays. How do I replace a bicycle inner tube?")).match_status).toBe("no_match");

    const wall = "A coastal town proposes a flood wall that protects a mobile-home park but closes a salt-marsh channel used by migrating fish. How should it decide?";
    const civic = await reflectPublicContext("civilization", wall);
    const moral = await reflectPublicContext("moral", wall);
    expect(civic.context_cards[0]?.id).toBe("ecological_boundary");
    expect(civic.source_refs).toContain("https://www.fisheries.noaa.gov/national/habitat-conservation/reopening-rivers-migratory-fish");
    expect(moral.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect(moral.source_refs).toContain("https://www.fisheries.noaa.gov/national/habitat-conservation/reopening-rivers-migratory-fish");
    expect((await reflectPublicContext("moral",
      'The screen quotes "a flood wall closes fish passage." How do I replace a bicycle inner tube?')).match_status).toBe("no_match");
    expect((await reflectPublicContext("moral",
      "Do not discuss a flood wall closing fish passage. How do I replace a bicycle inner tube?")).match_status).toBe("no_match");
  });

  it("generalizes water, school-support, and eel-barrier context without over-admitting controls", async () => {
    const water = await reflectPublicContext("civilization",
      "A rural district installs a generator for its water pumping system and promises drinking water during a heat-wave blackout. Is that resilient?");
    expect(water.context_cards.map((card) => card.id)).toContain("energy_capacity");
    expect(water.source_refs).toContain("https://www.epa.gov/waterresilience/power-resilience-guide-water-and-wastewater-utilities");

    const school = await reflectPublicContext("moral",
      "A school opens more support appointments, but disabled pupils with the greatest needs now wait longer for effective help. Is expansion successful?");
    expect(school.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect(school.source_refs).toContain("https://www.unicef.org/education/inclusive-education");
    expect(school.missing_evidence).toContainEqual(expect.stringContaining("affected pupils and families"));
    expect(school.claim_boundaries).toContainEqual(expect.stringContaining("acceptable delay"));

    const barrier = "A city proposes a river barrier that reduces flooding for renters but may block an eel migration route. Is it justified?";
    const civic = await reflectPublicContext("civilization", barrier);
    const moral = await reflectPublicContext("moral", barrier);
    expect(civic.context_cards[0]?.id).toBe("ecological_boundary");
    expect(civic.source_refs).toContain("https://www.fws.gov/story/reconnecting-american-eel-migrations");
    expect(moral.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect(moral.source_refs).toContain("https://www.fws.gov/story/reconnecting-american-eel-migrations");
    expect(moral.source_refs).not.toContain("https://www.fisheries.noaa.gov/national/habitat-conservation/reopening-rivers-migratory-fish");
    const cutOff = await reflectPublicContext("moral",
      "A town proposes a river barrier to protect a low-income neighborhood from floods, but it could cut off American eel migration. How should it decide?");
    expect(cutOff.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect(cutOff.source_refs).toContain("https://www.fws.gov/story/reconnecting-american-eel-migrations");
    for (const question of [
      'The screen quotes "a river barrier blocks eel migration." How do I tune a bicycle brake?',
      "Do not discuss river barriers or eels. How do I tune a bicycle brake?",
    ]) {
      expect((await reflectPublicContext("civilization", question)).match_status).toBe("no_match");
      expect((await reflectPublicContext("moral", question)).match_status).toBe("no_match");
    }
  });

  it("locates unnamed Pauli and plural backup-generator principles without leaking controls", async () => {
    const pauli = await reflectPublicContext("theory",
      "A museum placard says two electrons may overlap in position when their spins differ, so the exclusion rule puts no limit on electron arrangements in atoms. Is that conclusion justified?");
    expect(pauli.context_cards.map((card) => card.id)).toContain("physics.atomic.pauli_shell_structure");
    expect(pauli.source_refs).toContain("https://openstax.org/books/university-physics-volume-3/pages/11-1-introduction-to-particle-physics");

    const water = await reflectPublicContext("civilization",
      "A town installs larger backup generators for its water pumps, but the farthest block still loses pressure after every storm. What would establish whether service resilience improved?");
    expect(water.context_cards[0]?.id).toBe("energy_capacity");
    expect(water.source_refs).toContain("https://www.epa.gov/waterresilience/power-resilience-guide-water-and-wastewater-utilities");

    for (const question of [
      'The museum label quotes "two electrons overlap in position under the exclusion rule." How do I brew mint tea?',
      "Do not assess backup generators or water pumps; how do I inflate a bicycle tire?",
    ]) for (const lens of ["civilization", "theory", "moral"] as const)
      expect((await reflectPublicContext(lens, question)).match_status).toBe("no_match");
  });

  it("checks host-proposed principles against the full reviewed catalog without making them verdicts", async () => {
    const spin = await reflectPublicContext("theory",
      "A beam prepared along one axis is measured along another. Why do spin-one-half outcomes change?",
      ["Quantum spin relative to a measurement axis"]);
    expect(spin.context_cards[0]?.id).toBe("quantum.spin.measurement_axis_boundary");
    expect(spin.uncertainty).toContainEqual(expect.stringContaining("retrieval hypotheses"));
    expect(spin.terminal_eligible).toBe(false);

    const ferrofluid = await reflectPublicContext("theory",
      "Can a flat ferrofluid silhouette establish its three-dimensional physical mass quadrupole?",
      ["Two-phase physical mass quadrupole reconstruction"]);
    expect(ferrofluid.context_cards[0]?.id).toBe("lab.ferrofluid.mass_quadrupole_reconstruction_gate");
    expect(ferrofluid.context_cards.map((card) => card.id)).not.toContain("gravity.tides.quadrupole_orientation_torque");

    const maintenance = await reflectPublicContext("moral",
      "Should a strained living system maximize output before preserving viable maintenance?",
      ["Maintenance before optimization"]);
    expect(maintenance.context_cards[0]?.id).toBe("substrate.maintenance-before-optimization");

    const unrelated = await reflectPublicContext("theory", "How do I make oatmeal?",
      ["Pauli exclusion principle"]);
    expect(unrelated.match_status).toBe("no_match");
    const quoted = await reflectPublicContext("theory",
      'The page quotes "a beam changes spin outcomes by measurement axis." How do I make oatmeal?',
      ["Quantum spin relative to a measurement axis"]);
    expect(quoted.match_status).toBe("no_match");
    const routine = await reflectPublicContext("theory",
      "How do I charge a bicycle light with a small solar battery?",
      ["Casimir cavity static energy", "solar radiation field state", "battery energy density"]);
    expect(routine.match_status).toBe("no_match");
    const calculation = await reflectPublicContext("theory",
      "How do I calculate the energy limit of an ordinary two-body nuclear recoil?",
      ["ordinary elastic nuclear-recoil bound"]);
    expect(calculation.match_status).toBe("matched");
  });

  it("uses private graph search metadata for new science phrasing and a generic care shortfall", async () => {
    const nebula = "In a hot nebula, a strong hydrogen emission line is taken to prove it has more hydrogen than a cooler nebula. Is line brightness alone enough to infer abundance?";
    const science = await reflectPublicContext("theory", nebula, [
      "emission-line intensity depends on excitation and ionization conditions",
      "spectral line brightness is not a direct abundance measurement",
      "abundance inference requires calibration and comparison of physical conditions",
    ]);
    expect(science.context_cards.map((card) => card.id)).toContain("physics.atomic.ionization_charge_state_context");
    expect(science.context_cards.map((card) => card.id)).toContain("physics.atomic.spectra.line_broadening_context");
    expect(science.claim_boundaries).not.toContainEqual(expect.stringContaining("physics.radiation.laser_coherence_context:"));

    const oxygen = await reflectPublicContext("theory",
      "Two nebulae show different brightness in the same oxygen emission line. A report says the brighter one must contain more oxygen. What physical conditions must be checked before that inference?",
      [
        "emission-line intensity depends on excitation and ionization conditions as well as abundance",
        "line brightness depends on density, temperature, and radiative transfer",
        "observed flux depends on geometry, distance, extinction, and calibration",
      ]);
    expect(oxygen.context_cards.map((card) => card.id)).toEqual([
      "physics.atomic.spectra.line_broadening_context", "physics.atomic.level_population_context",
    ]);
    expect(oxygen.context_cards.map((card) => card.id))
      .not.toContain("study.casimir_dp.material_thermal_ordinary_null_stage4_2n");

    const laser = "A laser produces a narrow spectral line; does that alone show sustained population inversion and coherent gain?";
    expect((await reflectPublicContext("civilization", laser)).match_status).toBe("no_match");
    expect((await reflectPublicContext("theory", laser, ["population inversion as a gain condition"]))
      .context_cards.map((card) => card.id)).toContain("physics.radiation.laser_coherence_context");

    const foundation = "A foundation doubles food-distribution throughput by shortening individual intake interviews, but vulnerable families repeatedly miss essential nutrition support. Is growth enough?";
    expect((await reflectPublicContext("moral", foundation)).context_cards[0]?.id)
      .toBe("harm-weighted-priority-standard");
    expect((await reflectPublicContext("civilization", foundation)).match_status).toBe("no_match");
    expect((await reflectPublicContext("theory", foundation)).match_status).toBe("no_match");
  });

  it("keeps an unnamed nebular mechanism as an unverified lead when strict Theory admission misses", async () => {
    const result = await reflectPublicContext("theory",
      "Two nebulae show the same oxygen emission line, but it is much brighter in one. A student says the brighter nebula must contain more oxygen. What would test that claim, and what else could change the line brightness?",
      ["abundance versus excitation", "emission measure", "line diagnostic comparison"]);
    expect(result.match_status).toBe("no_match");
    expect(result.context_cards).toEqual([]);
    expect(result.candidate_cards.map((card) => card.id)).toEqual(["physics.atomic.level_population_context"]);
    expect(result.candidate_cards[0]?.needs_verification).toBe(true);
    expect(result.source_refs).toEqual([]);
    expect(result.terminal_eligible).toBe(false);
    for (const inactive of [
      'A page quotes "Two nebulae have different emission-line brightness." How do I make oatmeal?',
      "Do not analyze nebular emission lines. How do I clean a bicycle chain?",
      "I studied nebular emission lines last year. Today I need a recipe for oatmeal.",
      "Next year I may compare oxygen emission lines, but now how do I clean a bicycle chain?",
    ]) {
      const control = await reflectPublicContext("theory", inactive,
        ["abundance versus excitation", "emission measure", "line diagnostic comparison"]);
      expect(control.match_status).toBe("no_match");
      expect(control.candidate_cards).toEqual([]);
    }
  });

  it("offers a question-only Theory no-match a voluntary hypothesis retry without promoting evidence", async () => {
    const question = "Two star-forming clouds seem to have the same amount of nitrogen, yet the same nitrogen emission line is much brighter in one. What else could explain that, and what observations would separate the possibilities?";
    const result = await reflectPublicContext("theory", question);
    expect(result.match_status).toBe("no_match");
    expect(result.summary).toMatch(/may infer up to three short mechanism hypotheses.*call this reflection again/i);
    expect(result.summary).toContain("answer independently");
    expect(result.context_cards).toEqual([]);
    expect(result.source_refs).toEqual([]);
    expect(result.terminal_eligible).toBe(false);
    for (const inactive of [
      'The screen quotes "Two clouds have different nitrogen emission lines." How do I make oatmeal?',
      "Do not analyze nitrogen emission lines. How do I clean a bicycle chain?",
      "I studied nitrogen emission lines last year. Today I need a recipe for oatmeal.",
      "Next year I may compare nitrogen emission lines, but now how do I clean a bicycle chain?",
      "A screen shows a button named emission line. How do I repair a bicycle chain?",
    ]) {
      const control = await reflectPublicContext("theory", inactive);
      expect(control.match_status).toBe("no_match");
      expect(control.summary).not.toContain("call this reflection again");
    }
  });

  it("focuses apparent service success with affected-person harm on the relevant Moral procedure", async () => {
    const clinic = "A district keeps emergency clinic lights on with batteries, but flood damage blocks patient transport and delays essential treatment. Does the electrical backup establish reliable public access to care, and how should the harms be assessed?";
    const result = await reflectPublicContext("moral", clinic,
      ["effective care", "avoidable delay harms", "unequal burden"]);
    expect(result.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect(result.context_cards[0]?.concept).toMatch(/service proxy.*actual benefit.*harm/i);
    expect(result.context_cards[0]?.concept).toMatch(/authority for choosing value weights/i);
    expect(result.source_refs).toEqual([]);
    expect(result.context_cards[0]?.reference_status).toBe("no_public_reference");
    expect(result.missing_evidence[0]).toMatch(/no public source reference URL/i);
    expect(result.terminal_eligible).toBe(false);
    const pantry = await reflectPublicContext("moral",
      "A food pantry doubles the number of meals distributed, but clients with medical diets increasingly receive food they cannot safely eat. Is the larger count enough to judge the program successful?");
    expect(pantry.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect(pantry.summary).toContain("no verdict");
    const activeHypothetical = await reflectPublicContext("moral",
      "If next year's pantry doubles meals but clients cannot safely eat them, would the count be enough to call it successful?");
    expect(activeHypothetical.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    const mixedIntent = await reflectPublicContext("moral",
      "How do I boil an egg? Also, a pantry doubles meals while clients cannot safely eat them. Is the count enough to call it successful?");
    expect(mixedIntent.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    for (const inactive of [
      'The page quotes "The clinic lights are on but transport blocks care and harms patients." How do I boil an egg?',
      "Do not assess the clinic's delayed treatment or the pantry's unsafe meals. How do I wash a saucepan?",
      "Last year a clinic kept lights on while patients were delayed. Today I need a bread recipe.",
      "Next year a pantry may double meals while clients cannot safely eat them. How do I boil an egg?",
      "The screen shows a button labeled unsafe care; how do I clean a pan?",
    ]) {
      const control = await reflectPublicContext("moral", inactive,
        ["effective care", "avoidable delay harms", "unequal burden"]);
      expect(control.match_status).toBe("no_match");
      expect(control.context_cards).toEqual([]);
    }
  });

  it("admits an active access-risk tradeoff without presuming harm severity", async () => {
    const question = "A city adds battery-backed evacuation buses, but wheelchair users cannot board at a flooded stop. Does fleet uptime establish evacuation access, and how should the competing risks be assessed?";
    const active = await reflectPublicContext("moral", question,
      ["equal evacuation opportunity", "foreseeable exclusion harm", "risk distribution"]);
    expect(active.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect(active.claim_boundaries.join(" ")).toMatch(/Measure the harm, its severity and cause/);
    expect(active.claim_boundaries.join(" ")).not.toMatch(/cannot erase severe harm/i);
    const medication = await reflectPublicContext("moral",
      "An assisted-living home reports more medication rounds, but residents miss doses. Is the count enough to judge success?");
    expect(medication.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect(medication.claim_boundaries.join(" ")).not.toMatch(/cannot erase severe harm/i);
    const hypothetical = await reflectPublicContext("moral",
      "If a flood blocks wheelchair users from boarding a newly backed-up evacuation bus, how should the access risks be assessed?");
    expect(hypothetical.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    const mixed = await reflectPublicContext("moral",
      "How do I wash a mug? Also, battery-backed buses run but wheelchair riders cannot board at a flooded stop. How should the access risks be assessed?");
    expect(mixed.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    for (const inactive of [
      'The page quotes "Wheelchair users cannot board evacuation buses; assess the risks." How do I wash a mug?',
      "Do not assess the wheelchair riders' access risks. How do I wash a mug?",
      "Last year wheelchair riders could not board an evacuation bus. Today I need a mug-cleaning tip.",
      "Next year a flooded bus stop may block wheelchair users. Now how do I wash a mug?",
      "The screen shows a button labeled evacuation risk. How do I wash a mug?",
      "Bus fleet uptime is 99%. What was the route frequency by hour?",
    ]) {
      const control = await reflectPublicContext("moral", inactive,
        ["equal evacuation opportunity", "foreseeable exclusion harm"]);
      expect(control.match_status).toBe("no_match");
      expect(control.context_cards).toEqual([]);
    }
  });

  it("retains the cable's superconductivity limit without unrelated graph leads", async () => {
    const result = await reflectPublicContext("theory",
      "A cable prototype has zero measured DC resistance at low test current. Does that establish it can carry arbitrarily large grid current without losses? What observations would settle the practical claim?",
      ["current-dependent dissipation", "critical-current limits", "AC loss mechanisms"]);
    expect(result.context_cards.map((card) => card.id)).toEqual([
      "low_temp.superconductivity.zero_dc_resistance_bounds",
    ]);
    expect(result.candidate_cards).toEqual([]);
    const unnamedCoil = await reflectPublicContext("theory",
      "A chilled coil carries a small direct current with no measurable resistance. Can that observation justify indefinite operation at much higher current and magnetic field? What would test the operating limits?",
      ["critical-current limits", "thermal runaway mechanisms", "magnetic-field quenching"]);
    expect(unnamedCoil.context_cards.map((card) => card.id)).toEqual([
      "low_temp.superconductivity.zero_dc_resistance_bounds",
    ]);
    expect(unnamedCoil.candidate_cards).toEqual([]);
    const solar = await reflectPublicContext("theory",
      "What does a Zeeman split solar spectrum say about the magnetic field in a sunspot?",
      ["Zeeman magnetic splitting", "spectral line polarization"]);
    expect(solar.context_cards[0]?.id).toBe("solar.magnetic.zeeman_split_proxy");
    const ferrofluid = await reflectPublicContext("theory",
      "A ferrofluid ring loses phase lock with its rotating field as drive increases. Which measurement tests the step-out gate?",
      ["ferrofluid phase lock", "step-out threshold"]);
    expect(ferrofluid.context_cards[0]?.id).toBe("lab.ferrofluid.magnetic_phase_lock_stepout_gate");
    const plasma = await reflectPublicContext("theory",
      "A lab reports a wider spectral feature from its rotating plasma, while the feature's center stays put. Does an unchanged center rule out motion? What measurements would distinguish broadening mechanisms?",
      ["Doppler centroid cancellation", "Line-of-sight velocity distribution", "Instrumental versus physical width"]);
    expect(plasma.context_cards.map((card) => card.id)).toEqual([
      "physics.atomic.spectra.line_broadening_context",
    ]);
    expect(plasma.candidate_cards.map((card) => card.id)).not.toContain("solar.spectrum.radial_velocity_proxy");
    expect(plasma.candidate_cards.map((card) => card.id)).not.toContain("solar.spectrum.doppler_shift");
  });

  it("uses an inferred nuclear principle without admitting an unrelated badge from generic energy words", async () => {
    const result = await reflectPublicContext("theory",
      "An isotope nucleus has less measured mass than the sum of its free protons and neutrons. A student says some mass simply vanished. What physical accounting would you use to test that statement?",
      ["mass-energy equivalence", "nuclear binding energy", "conservation of energy and momentum"]);
    expect(result.context_cards.map((card) => card.id)).toEqual(["physics.mass_energy.nuclear_binding_energy"]);
    expect(result.source_refs).toContain("https://doi.org/10.1002/andp.19053231314");
    expect(result.source_refs).not.toContain("https://ligo.org/science-summaries/O2CWAllsky/");
  });

  it("anchors clock hints to the active observation instead of unrelated trip or apparatus cards", async () => {
    const result = await reflectPublicContext("theory",
      "Two identical optical clocks at different elevations drift apart after correcting for their motion. A lab says this proves one clock is defective. What measurements would distinguish a gravitational timing effect from an instrument problem?",
      ["gravitational redshift", "clock-comparison systematics", "general-relativistic time transfer"]);
    expect(result.context_cards.map((card) => card.id)).toEqual(["clock.yb171.terrestrial_redshift_prediction"]);
  });

  it("surfaces a redshift principle from an unnamed observation without broad catalog neighbors", async () => {
    const result = await reflectPublicContext("theory",
      "A spectroscopy chart shows a distant galaxy's hydrogen line at longer wavelength than a laboratory reference. Someone says this alone proves the galaxy is simply flying through static space. What quantities and alternative interpretations must be separated?",
      ["Observed redshift", "Relative motion", "Cosmological expansion"]);
    expect(result.context_cards[0]?.id).toBe("cosmic.spectral.redshift");
    expect(result.context_cards.map((card) => card.id))
      .not.toContain("stellar.spectroscopy.atomic_line_identification_context");
    expect(result.context_cards[0]?.reference_urls).toEqual([
      "https://openstax.org/books/astronomy/pages/26-5-the-expanding-universe",
    ]);
    expect(result.context_cards[0]?.reference_context[0]?.supports)
      .toContain("claim-specific support has not been verified");
  });

  it("offers bounded unverified mechanism alternatives when the strict card misses a plausible bridge", async () => {
    const question = "Two observers see a bright sodium emission line in different comet spectra. One claims the brighter line proves the first comet contains more sodium. What measurements and alternative explanations would test that inference?";
    const hints = ["line intensity calibration", "excitation versus abundance", "geometry and aperture effects"];
    const result = await reflectPublicContext("theory", question, hints);
    expect(result.context_cards[0]?.id).toBe("physics.atomic.spectra.line_broadening_context");
    expect(result.candidate_cards.map((card) => card.id))
      .toContain("physics.atomic.level_population_context");
    expect(result.candidate_cards.length).toBeLessThanOrEqual(6);
    expect(result.candidate_cards.every((card) => card.needs_verification)).toBe(true);
    expect(result.source_refs).toEqual([
      "https://physics.nist.gov/PhysRefData/ASD/Html/lineshelp.html",
    ]);

    const nativeHints = ["line emission physics", "abundance versus excitation", "calibrated spectral comparison"];
    const nativeResult = await reflectPublicContext("theory", question, nativeHints);
    expect(nativeResult.candidate_cards.map((card) => card.id)).toEqual([
      "astronomy.observational_inference.spectral_pipeline_context",
      "physics.atomic.level_population_context",
    ]);
    const variedHints = ["line emissivity conditions", "abundance versus excitation", "calibrated intensity comparison"];
    expect((await reflectPublicContext("theory", question, variedHints)).candidate_cards.map((card) => card.id))
      .toEqual(nativeResult.candidate_cards.map((card) => card.id));

    const catalog = await loadPublicBadgeCatalog();
    const search = await loadPublicBadgeSearchText();
    expect(findPublicExploratoryCandidates(catalog.theory, "How do I make oatmeal?", hints, search.theory))
      .toEqual([]);

    const strongConsent = await reflectPublicContext("moral",
      "A charity says clients consented to publishing their hardship stories because they attended a mandatory benefits intake and a disclosure notice was available on request. Does attendance establish voluntary consent?",
      ["participation versus consent", "power asymmetry and choice", "informed disclosure requirements"]);
    expect(strongConsent.context_cards.length).toBe(3);
    expect(strongConsent.candidate_cards).toEqual([]);
    const sourcedMarsh = await reflectPublicContext("moral",
      "A county proposes a causeway across tidal marsh so fuel trucks can reach a water-treatment plant during floods. What evidence and public decision process should govern the route?",
      ["ecological harm tradeoffs", "water access equity", "public participation consent"]);
    expect(sourcedMarsh.context_cards.some((card) => card.reference_urls.length > 0)).toBe(true);
    expect(sourcedMarsh.candidate_cards).toEqual([]);
  });

  it("omits exploratory Theory neighbors when a unique public title concept already fits the active question", async () => {
    const result = await reflectPublicContext("theory",
      "A lab sees a broadened spectral line from a hot gas. Does its width alone prove high temperature, and what other mechanisms need separating?",
      ["Doppler versus collisional broadening", "Pressure-dependent line broadening", "Line-center invariance"]);
    expect(result.context_cards[0]?.id).toBe("physics.atomic.spectra.line_broadening_context");
    expect(result.candidate_cards).toEqual([]);
    expect(result.context_cards[0]?.reference_status).toBe("catalog_pointer_only");
  });

  it("keeps a host-inferred unnamed principle as a quote-grounded lead rather than a matched card", async () => {
    const question = "A residential care provider reports more daily check-ins after introducing continuous monitoring, but residents say they cannot meaningfully decline it. Is the higher check-in count enough to establish that the policy is good?";
    const bridge = [{ principle: "meaningful consent", question_excerpt: "cannot meaningfully decline it" }];
    const catalog = await loadPublicBadgeCatalog();
    expect(findPublicQuestionAnchoredCandidates(catalog.moral, question, bridge))
      .toContain("participation-consent-separation");
    expect(findPublicQuestionAnchoredCandidates(catalog.moral, question,
      [{ ...bridge[0], question_excerpt: "residents signed a consent form" }])).toEqual([]);
    const result = await reflectPublicContext("moral", question,
      ["meaningful consent", "care quality outcomes"], bridge);
    expect(result.context_cards.map((card) => card.id)).not.toContain("participation-consent-separation");
    expect(result.candidate_cards).toContainEqual(expect.objectContaining({
      id: "participation-consent-separation", needs_verification: true,
      retrieval_basis: "host_hypothesis",
    }));
    expect(result.source_refs).toEqual([]);
    expect(result.uncertainty).toContainEqual(expect.stringContaining("exact excerpt confirms only"));
    const quoted = await reflectPublicContext("moral",
      'The page says "residents cannot meaningfully decline it." How do I clean a bicycle chain?',
      ["meaningful consent"], bridge);
    expect(quoted.candidate_cards).toEqual([]);
  });

  it("requires the target of a relational badge title before a host hint can locate it", async () => {
    const question = "A care provider records more resident check-ins through continuous monitoring. Residents lose access to help if they opt out. Does high enrollment show that the arrangement is good?";
    const hints = ["voluntary consent", "conditional access", "care quality outcomes"];
    const bridges = [
      { principle: hints[0], question_excerpt: "Residents lose access to help if they opt out." },
      { principle: hints[1], question_excerpt: "Residents lose access to help if they opt out." },
      { principle: hints[2], question_excerpt: "Does high enrollment show that the arrangement is good?" },
    ];
    const catalog = await loadPublicBadgeCatalog();
    const search = await loadPublicBadgeSearchText();
    const strict = findPublicPrincipleHypotheses(catalog.moral, question, hints, search.moral,
      { allowRareTitleAnchor: true });
    const weak = findPublicQuestionAnchoredCandidates(catalog.moral, question, bridges);
    expect(strict).not.toContain("access-to-counsel-pathway");
    expect(strict).not.toContain("due-care-before-judgment");
    expect(weak).toContain("participation-consent-separation");
    expect(weak).not.toContain("access-to-counsel-pathway");
    expect(weak).not.toContain("due-care-before-judgment");
    const result = await reflectPublicContext("moral", question, hints, bridges);
    expect(result.likely_badges.map((badge) => badge.id)).not.toContain("access-to-counsel-pathway");
    expect(result.candidate_cards.map((card) => card.id)).toContain("participation-consent-separation");
    expect(result.candidate_cards.map((card) => card.id)).not.toContain("access-to-counsel-pathway");
    expect(result.candidate_cards.map((card) => card.id)).not.toContain("due-care-before-judgment");
    expect(result.candidate_cards.map((card) => card.id)).not.toContain("love-without-projection");
    expect(result.source_refs).toEqual([]);
    expect(findPublicQuestionAnchoredCandidates(catalog.moral,
      "Residents must find counsel before the appeal deadline. Is counsel actually reachable?",
      [{ principle: "access to counsel", question_excerpt: "find counsel before the appeal deadline" }]))
      .toContain("access-to-counsel-pathway");
  });

  it("does not locate a slash-related curvature badge from one shared body word", async () => {
    const question = "A proposed free 1e-15 eV particle crosses a germanium detector at 250 km/s. A 5 keV nuclear recoil is reported. Could ordinary two-body elastic scattering by one such particle account for it, or does a dense wave solve the energy mismatch? Show the controlling bound.";
    const bridge = [{ principle: "Two-body kinematic ceiling",
      question_excerpt: "ordinary two-body elastic scattering" }];
    const catalog = await loadPublicBadgeCatalog();
    expect(findPublicQuestionAnchoredCandidates(catalog.theory, question, bridge))
      .not.toContain("curvature.proxy.drive_body_ratio");
    const result = await reflectPublicContext("theory", question,
      ["Two-body kinematic ceiling", "Momentum-transfer matching"], bridge);
    expect(result.context_cards.map((card) => card.id))
      .toContain("physics.scattering.elastic_nuclear_recoil_bound");
    expect(result.candidate_cards.map((card) => card.id))
      .not.toContain("curvature.proxy.drive_body_ratio");
    expect(findPublicQuestionAnchoredCandidates(catalog.theory,
      "Could a drive/body curvature ratio help compare two curvature proxies?",
      [{ principle: "drive body curvature ratio", question_excerpt: "drive/body curvature ratio" }]))
      .toContain("curvature.proxy.drive_body_ratio");
  });

  it("omits a semantically wrong quote bridge when the question names a different Theory concept", async () => {
    const question = "Two comet spectra show the same sodium emission line, but one is much brighter. Does that prove more sodium?";
    const result = await reflectPublicContext("theory", question, [],
      [{ principle: "laser coherence", question_excerpt: "same sodium emission line" }]);
    expect(result.context_cards.map((card) => card.id))
      .not.toContain("physics.radiation.laser_coherence_context");
    expect(result.context_cards.map((card) => card.id)).toContain("element.na.origin");
    expect(result.candidate_cards).toEqual([]);
  });

  it("admits only an active quoted span for a host-inferred bridge across prompt contexts", async () => {
    const bridge = [{ principle: "meaningful consent", question_excerpt: "cannot meaningfully decline it" }];
    const active = [
      ["If residents cannot meaningfully decline it, should a future monitoring program count participation as consent?",
        "cannot meaningfully decline it"],
      ["Residents could not meaningfully decline it last year. Was participation evidence of consent?",
        "could not meaningfully decline it"],
    ];
    for (const [question, excerpt] of active) {
      const result = await reflectPublicContext("moral", question, [],
        [{ principle: "meaningful consent", question_excerpt: excerpt }]);
      expect([...result.context_cards, ...result.candidate_cards].map((card) => card.id))
        .toContain("participation-consent-separation");
      expect(result.terminal_eligible).toBe(false);
    }
    const inactive = [
      'The page quotes "residents cannot meaningfully decline it." How do I clean a bicycle chain?',
      'The screen shows "residents cannot meaningfully decline it." How do I fix a bicycle tire?',
      "Do not assess whether residents cannot meaningfully decline it. How do I clean a bicycle chain?",
      "Residents cannot meaningfully decline it in the quoted policy example; my question is how to clean a bicycle chain.",
    ];
    for (const question of inactive) {
      const result = await reflectPublicContext("moral", question, [], bridge);
      expect(result.candidate_cards).toEqual([]);
    }
  });

  it("does not promote a laser badge from a comet emission-line question sharing only one public-summary term", async () => {
    const result = await reflectPublicContext("theory",
      "Two comet spectra show the same sodium emission line, but one is much brighter. Does that alone prove the brighter comet contains more sodium? What would test it?",
      ["emission excitation conditions", "distance and geometry effects", "abundance versus brightness"]);
    expect(result.context_cards.map((card) => card.id)).not.toContain("physics.radiation.laser_coherence_context");
    expect(result.source_refs).toEqual([]);
    expect(result.terminal_eligible).toBe(false);
  });

  it("turns civic receipt codes into usable checks and keeps source gaps visible", async () => {
    const result = await reflectPublicContext("civilization",
      "A rural health district doubles its telehealth appointments, but villages lose broadband and backup power during storms. Has practical access to care improved?");
    expect(result.context_cards.length).toBeGreaterThan(0);
    expect(result.missing_evidence[0]).toContain("no public source reference URL");
    expect(result.missing_evidence).toContainEqual(expect.stringContaining("Measure actual reach, delay, interruption"));
    expect(result.missing_evidence.some((item) => /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(item)))
      .toBe(false);
  });

  it("keeps ordinary bus access distinct from electric-bus charging", async () => {
    const cooling = await reflectPublicContext("civilization",
      "A city calls its solar-powered cooling library resilient because the lights and air conditioning stayed on during a heat wave. The only bus route stopped, and several mobility-impaired residents could not enter. Did public heat protection improve, and what should be measured?");
    const transit = cooling.context_cards.find((card) => card.id === "transport_latency");
    expect(transit?.concept).toMatch(/physical accessibility.*actual service reach/i);
    expect(transit?.concept).not.toMatch(/charg|electric-bus/i);
    expect(transit?.reference_urls).not.toContain("https://www.transit.dot.gov/sites/fta.dot.gov/files/2023-08/FTA-Report-No-0254.pdf");
    expect(cooling.missing_evidence.join(" ")).not.toMatch(/charging availability/i);
    const electric = await reflectPublicContext("civilization",
      "A city promises an electric-bus expansion, but evening service would be cut to charge the fleet. What must it measure before claiming better access?");
    expect(electric.context_cards.find((card) => card.id === "transport_latency")?.concept).toMatch(/charging uptime/i);
    expect(electric.source_refs).toContain("https://www.transit.dot.gov/sites/fta.dot.gov/files/2023-08/FTA-Report-No-0254.pdf");
    expect((await reflectPublicContext("civilization",
      'The screen quotes "electric buses lose charging and villages lose service." How do I replace a bicycle tire?')).match_status).toBe("no_match");
  });

  it("offers only tentative source-linked Theory leads from an active question alone", async () => {
    const question = "At an alkaline vent, mineral pores concentrate molecules and maintain a pH difference. Does this already show a living organism or heredity, and what steps remain?";
    const result = await reflectPublicContext("theory", question);
    expect(result.match_status).toBe("no_match");
    expect(result.context_cards).toEqual([]);
    expect(result.source_refs).toEqual([]);
    expect(result.candidate_cards.map((card) => card.id)).toEqual([
      "bio.origin.alkaline_vent_proton_gradient",
      "bio.origin.inorganic_compartment_barrier",
      "bio.origin.local_concentration_before_replication",
    ]);
    expect(result.candidate_cards.every((card) => card.needs_verification &&
      card.url.startsWith("https://casimirbot.com/context/badges/theory/"))).toBe(true);
    expect(result.candidate_cards.every((card) =>
      card.catalog_source_pointers?.length && card.catalog_source_pointers.length <= 2 &&
      card.catalog_source_pointers.every((url) => url.startsWith("https://")) &&
      card.claim_boundaries?.length)).toBe(true);
    expect(result.uncertainty.join(" ")).toMatch(/tentative search leads/);
    expect(result.uncertainty.join(" ")).toMatch(/unchecked for this question/);
    for (const active of [
      "If a future alkaline vent experiment finds mineral pores that concentrate molecules, would that already prove a living organism or heredity?",
      "A historical alkaline vent experiment found mineral pores that concentrate molecules. Did that already prove a living organism or heredity?",
      "At an alkaline vent, mineral pores concentrate molecules. Does this show life? Separately, what should a city measure before building a flood barrier?",
    ]) {
      expect((await reflectPublicContext("theory", active)).candidate_cards.map((card) => card.id))
        .toContain("bio.origin.alkaline_vent_proton_gradient");
    }
    for (const inactive of [
      "A screen quotes 'At an alkaline vent, mineral pores concentrate molecules and maintain a pH difference.' How do I clean a bicycle chain?",
      "Do not discuss alkaline vents, mineral pores, organisms, or heredity. How do I clean a bicycle chain?",
      "An old lecture covered alkaline vents, mineral pores, and the origin of organisms. My actual question is how city buses are funded. What should a city measure?",
      "Two optical-clock transition frequencies drift together as room temperature rises. Does that show a fundamental constant is changing?",
      "How do I bake bread?",
    ]) {
      expect((await reflectPublicContext("theory", inactive)).candidate_cards).toEqual([]);
    }
  });

  it("keeps relation paths off by default and tentative in the local trial", async () => {
    const question = "At an alkaline vent, mineral pores concentrate molecules and maintain a pH difference. Does this already show a living organism or heredity, and what steps remain?";
    const previous = process.env.CASIMIR_PUBLIC_CONTEXT_EXPERIMENTAL_RELATIONS;
    delete process.env.CASIMIR_PUBLIC_CONTEXT_EXPERIMENTAL_RELATIONS;
    try {
      const ordinary = await reflectPublicContext("theory", question);
      expect(ordinary.relation_path_leads).toBeUndefined();
      expect(ordinary.convergent_relation_leads).toBeUndefined();
      process.env.CASIMIR_PUBLIC_CONTEXT_EXPERIMENTAL_RELATIONS = "1";
      const trial = await reflectPublicContext("theory", question);
      expect(trial.match_status).toBe("no_match");
      expect(trial.source_refs).toEqual([]);
      expect(trial.relation_path_leads?.some((path) =>
        path.from_id === "bio.origin.alkaline_vent_proton_gradient" &&
        path.to_id === "bio.origin.inorganic_compartment_barrier" &&
        path.status === "unverified_graph_lead" &&
        path.steps.every((step) => step.claim_boundary.length > 0))).toBe(true);
      const paraphrase = "At an alkaline seafloor vent, mineral pores maintain a pH difference and concentrate organic molecules. A team calls this early living evolution. What would have to be observed before that wording is justified?";
      const pathLocated = await reflectPublicContext("theory", paraphrase);
      expect(pathLocated.match_status).toBe("no_match");
      expect(pathLocated.source_refs).toEqual([]);
      expect(pathLocated.candidate_cards.map((card) => card.id)).toEqual([
        "bio.origin.alkaline_vent_proton_gradient",
        "bio.origin.inorganic_compartment_barrier",
        "bio.origin.local_concentration_before_replication",
      ]);
      expect(pathLocated.candidate_cards.every((card) => card.retrieval_basis === "graph_path")).toBe(true);
      const convergenceQuestion = "A driven magnon sample oscillates at half the drive frequency in a noisy room-temperature trace. Does that show a discrete time crystal, and what would distinguish it from an ordinary driven response?";
      const convergent = await reflectPublicContext("theory", convergenceQuestion);
      expect(convergent.match_status).toBe("no_match");
      expect(convergent.source_refs).toEqual([]);
      expect(convergent.convergent_relation_leads).toEqual(expect.arrayContaining([
        expect.objectContaining({
          status: "unverified_graph_lead",
          target_badge: expect.objectContaining({
            id: "matter.phase.time_crystal_observable_signature_context",
            catalog_source_pointers: expect.arrayContaining([expect.stringMatching(/^https:\/\//)]),
          }),
          incoming_steps: expect.arrayContaining([
            expect.objectContaining({ from_id: "matter.phase.floquet_discrete_time_crystal_context" }),
            expect.objectContaining({ from_id: "matter.phase.prethermal_discrete_time_crystal_context" }),
          ]),
        }),
      ]));
      expect(convergent.convergent_relation_leads?.[0].incoming_steps.every((step) =>
        step.claim_boundary.length > 0)).toBe(true);
      expect((await reflectPublicContext("theory", convergenceQuestion.replace("Does that show", "Will a future sample show")))
        .convergent_relation_leads?.[0].status).toBe("unverified_graph_lead");
      for (const active of [
        "If a future alkaline seafloor vent has mineral pores and concentrated organic molecules, would that alone establish living evolution?",
        "A historical alkaline seafloor vent had mineral pores and concentrated organic molecules. Did that establish living evolution?",
      ]) {
        expect((await reflectPublicContext("theory", active)).candidate_cards.map((card) => card.id))
          .toContain("bio.origin.alkaline_vent_proton_gradient");
      }
      const molecular = await reflectPublicContext("theory",
        "Two microwave lines from a cold cloud fit a candidate organic molecule. A team says the molecule formed in that cloud and traveled intact into planet-forming solids. What can the lines support, and what observations would distinguish detection, origin, and delivery?",
        ["Spectral-identification limits", "Chemical formation pathways", "Inheritance versus reprocessing"]);
      expect(molecular.relation_path_leads?.some((path) =>
        path.steps.some((step) => step.from_id.startsWith("stellar.") || step.to_id.startsWith("stellar.")))).toBe(false);
      expect(molecular.convergent_relation_leads?.some((lead) =>
        lead.target_badge.id.startsWith("stellar.") || lead.incoming_steps.some((step) =>
          step.from_id.startsWith("stellar.")))).toBe(false);
      expect(molecular.relation_path_leads?.some((path) =>
        path.from_id === "astrochemistry.lab_spectroscopy.molecular_fingerprint_foundation" &&
        path.to_id === "astrochemistry.claim_boundary.spectral_model_inference_only")).toBe(true);
      const irrelevant = await reflectPublicContext("theory",
        'A screen quotes "At an alkaline vent, mineral pores concentrate molecules." How do I clean a bicycle chain?');
      expect(irrelevant.match_status).toBe("no_match");
      expect(irrelevant.relation_path_leads).toBeUndefined();
      expect(irrelevant.convergent_relation_leads).toBeUndefined();
      for (const inactive of [
        'The screen quotes "An alkaline seafloor vent has mineral pores and concentrated organic molecules." How do I clean a bicycle chain?',
        "Do not discuss alkaline seafloor vents or mineral pores. How do I clean a bicycle chain?",
        "An old lecture covered alkaline seafloor vents and mineral pores. My actual question is how city buses are funded. What should a city measure?",
      ]) {
        expect((await reflectPublicContext("theory", inactive)).candidate_cards).toEqual([]);
      }
    } finally {
      if (previous === undefined) delete process.env.CASIMIR_PUBLIC_CONTEXT_EXPERIMENTAL_RELATIONS;
      else process.env.CASIMIR_PUBLIC_CONTEXT_EXPERIMENTAL_RELATIONS = previous;
    }
  });

  it("does not use an atomic line database as a molecular microwave source", async () => {
    const result = await reflectPublicContext("theory",
      "Two microwave lines from a cold cloud fit a candidate organic molecule. A team says the molecule formed in that cloud and traveled intact into planet-forming solids. What can the lines support, and what observations would distinguish detection, origin, and delivery?",
      ["Spectral-identification limits", "Chemical formation pathways", "Inheritance versus reprocessing"]);
    expect(result.context_cards.map((card) => card.id))
      .toContain("astrochemistry.claim_boundary.spectral_identification_only");
    expect(result.source_refs).not.toContain("https://physics.nist.gov/PhysRefData/ASD/Html/lineshelp.html");
    expect(result.context_cards.flatMap((card) => card.reference_context.map((ref) => ref.url)))
      .not.toContain("https://physics.nist.gov/PhysRefData/ASD/Html/lineshelp.html");
    expect(result.missing_evidence.join(" ")).toMatch(/covers atoms and ions, not identification of the molecule/i);
    expect(result.terminal_eligible).toBe(false);
    const radio = await reflectPublicContext("theory",
      "Radio spectra from a cold cloud show two lines matching a proposed organic molecule. A press release says this proves the molecule formed there and remained intact through planet formation. What would validate each step?",
      ["Spectral-line identification", "Formation-site attribution", "Survival through processing"]);
    expect([...radio.context_cards, ...radio.candidate_cards].map((card) => card.id))
      .not.toContain("stellar.spectroscopy.atomic_line_identification_context");
    expect(radio.source_refs).not.toContain("https://openstax.org/books/astronomy-2e/pages/17-3-the-spectra-of-stars-and-brown-dwarfs");
    const atomic = await reflectPublicContext("theory",
      "Two atomic hydrogen absorption lines appear in a stellar spectrum. What can atomic line identification support, and what remains uncertain about composition?",
      ["Atomic line identification"]);
    expect(atomic.context_cards.map((card) => card.id))
      .toContain("stellar.spectroscopy.atomic_line_identification_context");
  });

  it("keeps a direct participation-versus-consent badge in the visible moral cards", async () => {
    const result = await reflectPublicContext("moral",
      "A school says families consented to student data sharing because they attended a meeting, although enrollment required accepting it and the opt-out was hidden. Is participation evidence of voluntary consent?",
      ["Voluntary informed consent", "Power asymmetry", "Meaningful opt-out"]);
    expect(result.context_cards[0]?.id).toBe("participation-consent-separation");
    expect(result.context_cards[0]?.reference_urls).toEqual([]);
  });

  it("uses a rare catalog title bridge for mandatory-intake consent without a named participation hint", async () => {
    const result = await reflectPublicContext("moral",
      "A charity says clients consented to publishing their hardship stories because they attended a mandatory benefits intake and a disclosure notice was available on request. Does attendance establish voluntary consent?",
      ["voluntary informed consent", "power imbalance", "coercion and dependency"]);
    expect(result.context_cards[0]?.id).toBe("participation-consent-separation");
    expect(result.context_cards[0]?.reference_urls).toEqual([]);
    const differentHints = await reflectPublicContext("moral",
      "A charity says clients consented to publishing their hardship stories because they attended a mandatory benefits intake and a disclosure notice was available on request. Does attendance establish voluntary consent?",
      ["voluntary choice under dependency", "notice accessibility", "coercive service conditions"]);
    expect(differentHints.context_cards[0]?.id).toBe("participation-consent-separation");
  });

  it("admits a marsh siting question through the same ecological vocabulary used downstream", async () => {
    const result = await reflectPublicContext("moral",
      "A county proposes a causeway across tidal marsh so fuel trucks can reach a water-treatment plant during floods. What evidence and public decision process should govern the route?",
      ["distributional fairness", "marsh ecosystem harms", "intergenerational duty"]);
    expect(result.match_status).toBe("matched");
    expect(result.context_cards[0]?.id).toBe("harm-weighted-priority-standard");
  });

  it("prioritizes a located consent distinction and recognizes implied habitat siting harm", async () => {
    const consent = await reflectPublicContext("moral",
      "A charity discloses relocation risks only after residents sign up. People could attend a public meeting, but could not withdraw afterward. Does attendance establish informed consent?",
      ["public meeting participation is not informed consent"]);
    expect(consent.context_cards[0]?.id).toBe("participation-consent-separation");

    const siting = await reflectPublicContext("moral",
      "A town proposes an emergency ferry landing through eel habitat so isolated neighborhoods can get medicine during floods. What evidence and public decision process should govern it?",
      ["duty to protect vulnerable residents", "avoidance and mitigation of ecological harm", "fair distribution of risks and benefits"]);
    expect(siting.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect(siting.source_refs).toContain("https://www.fws.gov/policy-library/501fw2");
  });

  it("separates public water inventory from point-of-use access with a scoped service reference", async () => {
    const result = await reflectPublicContext("civilization",
      "A city adds reservoir capacity, but upper-floor taps in an outer neighborhood go dry during a heat wave. Can officials say access to water improved?",
      ["effective access rather than nominal infrastructure capacity"]);
    expect(result.context_cards[0]?.id).toBe("material_base");
    expect(result.context_cards[0]?.concept).toMatch(/stored water.*delivered household service/i);
    expect(result.source_refs).toContain("https://washdata.org/topics/drinking-water");
    expect(result.context_cards[0]?.reference_context[0]?.supports).toMatch(/does not establish local pressure/i);
  });

  it("resolves exact reviewed titles across graph families without accepting an unrelated forced title", async () => {
    const catalog = await loadPublicBadgeCatalog();
    const index = await loadPublicBadgeSearchText();
    for (const [lens, id] of [
      ["theory", "physics.energy.energy_density"],
      ["theory", "physics.atomic.level_population_context"],
      ["moral", "middle-way"],
      ["moral", "citizens-arc"],
    ] as const) {
      const badge = catalog[lens].find((candidate) => candidate.id === id);
      expect(badge).toBeDefined();
      expect(findPublicPrincipleHypotheses(catalog[lens], badge!.summary, [badge!.title], index[lens]))
        .toContain(id);
      expect(findPublicPrincipleHypotheses(catalog[lens], "How do I make oatmeal?", [badge!.title], index[lens]))
        .not.toContain(id);
    }
  });

  it("does not treat quoted or excluded Pauli wording as the question", async () => {
    const questions = [
      'The page quotes "Can fermions and bosons occupy the same space?" What is a good bread recipe?',
      "Do not explain fermions and bosons overlapping. How do I bake bread?",
    ];
    for (const question of questions) {
      const result = await reflectPublicContext("theory", question);
      expect([...result.exact_badges, ...result.likely_badges].map((badge) => badge.id))
        .not.toContain("physics.atomic.pauli_shell_structure");
      expect(result.terminal_eligible).toBe(false);
    }
  });

  it("keeps an explicitly named public Theory concept ahead of weaker host hypotheses", async () => {
    const question = "A detector reports two identical electrons at the same position at the same instant and calls it a violation of Pauli exclusion. What state information and measurement limits are missing?";
    const result = await reflectPublicContext("theory", question,
      ["Full quantum state", "Detector resolution limits", "Fermionic antisymmetry"], [
        { principle: "Full quantum state", question_excerpt: "What state information and measurement limits are missing?" },
        { principle: "Detector resolution limits", question_excerpt: "measurement limits are missing" },
      ]);
    expect(result.context_cards.map((card) => card.id)).toEqual(["physics.atomic.pauli_shell_structure"]);
    expect(result.candidate_cards).toEqual([]);
    expect(result.source_refs).toContain("https://openstax.org/books/university-physics-volume-3/pages/11-1-introduction-to-particle-physics");
    for (const inactive of [
      'A screen quotes "two identical electrons at the same position violate Pauli exclusion." How do I clean a bicycle chain?',
      "Do not analyze Pauli exclusion or electrons. How do I clean a bicycle chain?",
      "Yesterday we discussed Pauli exclusion. How do I clean a bicycle chain?",
      "Tomorrow I will ask about Pauli exclusion. Today, how do I clean a bicycle chain?",
      "If a future detector says two identical electrons occupy the same position, we can discuss Pauli exclusion later. For now how do I clean a bicycle chain?",
      "A detector claims two electrons at the same position violate Pauli exclusion. Also, how do I clean a bicycle chain?",
    ]) {
      const control = await reflectPublicContext("theory", inactive);
      expect(control.context_cards).toEqual([]);
      expect(control.source_refs).toEqual([]);
    }
  });

  it("locates the exclusion distinction from ordinary light and electron spatial wording", async () => {
    for (const question of [
      "Can a photon and an electron occupy the same region at the same time?",
      "Does a laser beam passing through an electron cloud violate a rule that particles must stay in separate places?",
    ]) {
      const result = await reflectPublicContext("theory", question);
      expect(result.context_cards[0]?.id).toBe("physics.atomic.pauli_shell_structure");
      expect(result.context_cards[0]?.concept).toContain("complete quantum state");
      expect(result.source_refs).toContain("https://openstax.org/books/university-physics-volume-3/pages/11-1-introduction-to-particle-physics");
      expect(result.claim_boundaries.join(" ")).not.toMatch(/massless_photon_kinematics|electron_cloud_uncertainty_floor/);
      expect(result.terminal_eligible).toBe(false);
    }
    for (const question of [
      'The article asks, "Can a photon and an electron occupy the same region?" How do I grease a bicycle chain?',
      "Do not discuss electrons sharing an orbital. How do I grease a bicycle chain?",
      "Can my desktop icon and mouse pointer occupy the same pixel?",
    ]) {
      expect((await reflectPublicContext("theory", question)).match_status).toBe("no_match");
    }
  });

  it("focuses storm water service and marsh generator siting on sourced civic and moral cards", async () => {
    const water = await reflectPublicContext("civilization",
      "A school district proposes battery-powered water pumps for three days after storms. Which measurements would show whether every neighborhood still has safe tap water?");
    expect(water.context_cards[0]?.id).toBe("energy_capacity");
    expect(water.source_refs).toContain("https://www.epa.gov/waterresilience/power-resilience-guide-water-and-wastewater-utilities");
    expect(water.missing_evidence.join(" ")).toMatch(/pressure and water-quality limits/);

    const siting = "A coastal town wants a backup generator beside a marsh that shelters nesting birds. What evidence and tradeoffs should residents review before approving the site?";
    const civic = await reflectPublicContext("civilization", siting);
    const moral = await reflectPublicContext("moral", siting);
    expect(civic.context_cards[0]?.id).toBe("ecological_boundary");
    expect(civic.source_refs).toContain("https://www.epa.gov/wetlands/basic-information-about-wetland-restoration-and-protection");
    expect(moral.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect(moral.source_refs).toContain("https://www.fws.gov/policy-library/501fw2");
    expect(moral.claim_boundaries.join(" ")).toMatch(/does not set an approval threshold/);
    for (const question of [
      'The article asks "Could a photon and an electron overlap in space inside an atom?" How do I oil a bicycle chain?',
      "Do not assess the town's generator, marsh, or birds. Tell me how to cook rice.",
    ]) {
      for (const lens of ["theory", "civilization", "moral"] as const) {
        expect((await reflectPublicContext(lens, question)).match_status).toBe("no_match");
      }
    }
  });

  it("keeps contextual control language inside evidence-only reflection", async () => {
    const questions = [
      'The page quotes "start the run"; what social constraints matter?',
      "Do not start a run; assess a proposed energy corridor's social limits.",
      "We started a run last year. What evidence about society would still be missing?",
      "If we might start a run later, what moral concerns should we inspect now?",
      "The screen shows a Run button, but I am asking whether the theory supports this claim.",
    ];
    for (const question of questions) {
      const lens = /moral concerns/.test(question) ? "moral" : /theory supports/.test(question) ? "theory" : "civilization";
      const result = await reflectPublicContext(lens, question);
      expect(result.terminal_eligible).toBe(false);
      expect(result.assistant_answer).toBe(false);
      expect(result.claim_boundaries.length).toBeGreaterThan(0);
    }
  });

  it("serves paginated public pages and only three anonymous MCP tools", async () => {
    const app = express();
    app.use(createPublicBadgeCatalogRouter(() => true));
    app.use("/mcp/public-context", createPublicContextMcpRouter(() => true));
    const catalog = await request(app).get("/context/badges").expect(200);
    expect(catalog.text).toContain("Public badge catalog");
    const badges = await request(app).get("/context/badges/theory?page=1").expect(200);
    expect(badges.text).toContain("public concepts");
    for (const lens of ["civilization", "theory", "moral"] as const) {
      const badge = (await loadPublicBadgeCatalog())[lens][0];
      const detail = await request(app).get(`/context/badges/${lens}/${encodeURIComponent(badge.id)}`).expect(200);
      expect(detail.text).toContain("<h2>Uncertainty</h2>");
      expect(detail.text).toContain(badge.uncertainty[0].replaceAll("'", "&#39;"));
    }
    const unsourced = (await loadPublicBadgeCatalog()).theory.find((badge) => badge.source_refs.length === 0);
    if (unsourced) {
      const detail = await request(app).get(`/context/badges/theory/${encodeURIComponent(unsourced.id)}`).expect(200);
      expect(detail.text).toContain("No public source reference is attached");
    }
    const initialized = await request(app).post("/mcp/public-context")
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
        protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" },
      } });
    expect(initialized.status).toBe(200);
    expect(initialized.body.result.instructions).toMatch(/consider a read-only reflection/);
    expect(initialized.body.result.instructions).toMatch(/ignore irrelevant cards/);
    expect(initialized.body.result.instructions).toMatch(/no public reference URL is a question checklist/i);
    expect(initialized.body.result.instructions).toMatch(/quoted, negated, screen-visible/);
    const listed = await request(app).post("/mcp/public-context")
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(listed.status).toBe(200);
    expect(listed.body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "casimir_civilization_bounds_reflect", "casimir_theory_badges_reflect", "casimir_moral_graph_reflect",
    ]);
    expect(listed.body.result.tools[0].description).toMatch(/public count.*service people actually receive/i);
    expect(listed.body.result.tools[0].description).toMatch(/effective-care or welfare question belongs to Moral/i);
    expect(listed.body.result.tools[1].description).toMatch(/observation is used to infer physical composition, mechanism, feasibility, or a theory limit/i);
    expect(listed.body.result.tools[1].description).toMatch(/never text to restate automatically/i);
    expect(listed.body.result.tools[1].description).toMatch(/ecological siting belong to Civilization/i);
    expect(listed.body.result.tools[1].description).toMatch(/Skip routine mechanical repair/i);
    expect(listed.body.result.tools[2].description).toMatch(/participation, activity, benefit, or safety metrics.*infer consent/i);
    expect(listed.body.result.tools[2].description).toMatch(/Skip unrelated quoted or personal how-to text/i);
    expect(listed.body.result.tools[1].inputSchema.properties.question.description).toMatch(/current question/i);
    expect(listed.body.result.tools[1].inputSchema.properties.candidate_principles.maxItems).toBe(3);
    expect(listed.body.result.tools[1].inputSchema.properties.candidate_bridges.maxItems).toBe(3);
    expect(listed.body.result.tools[1].outputSchema.properties.context_cards).toBeDefined();
    expect(listed.body.result.tools[1].outputSchema.properties.context_cards.items.properties.reference_context).toBeDefined();
    const call = await request(app).post("/mcp/public-context")
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: {
        name: "casimir_civilization_bounds_reflect",
        arguments: { question: 'The screen says "start run"; do not start anything. What limits matter for society?' },
      } }).expect(200);
    expect(call.body.result.structuredContent).toMatchObject({
      lens: "civilization", terminal_eligible: false, assistant_answer: false,
    });
    const hinted = await request(app).post("/mcp/public-context")
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 33, method: "tools/call", params: {
        name: "casimir_theory_badges_reflect", arguments: {
          question: "A beam prepared along one axis is measured along another. Why do spin-one-half outcomes change?",
          candidate_principles: ["Quantum spin relative to a measurement axis"],
        },
      } }).expect(200);
    expect(hinted.body.result.structuredContent.context_cards[0].id)
      .toBe("quantum.spin.measurement_axis_boundary");
    const bridged = await request(app).post("/mcp/public-context")
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 34, method: "tools/call", params: {
        name: "casimir_moral_graph_reflect", arguments: {
          question: "A care provider has more check-ins, but residents cannot meaningfully decline monitoring. Does the count prove benefit?",
          candidate_bridges: [{
            principle: "meaningful consent", question_excerpt: "cannot meaningfully decline monitoring",
          }],
        },
      } }).expect(200);
    expect(bridged.body.result.structuredContent.candidate_cards)
      .toContainEqual(expect.objectContaining({
        id: "participation-consent-separation", retrieval_basis: "host_hypothesis",
      }));
    const forbidden = await request(app).post("/mcp/public-context")
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: {
        name: "helix_workstation_capability_call", arguments: {},
      } }).expect(200);
    expect(forbidden.body.result.isError).toBe(true);
    const oversizedQuestion = await request(app).post("/mcp/public-context")
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: {
        name: "casimir_theory_badges_reflect", arguments: { question: "x".repeat(4001) },
      } }).expect(200);
    expect(oversizedQuestion.body.result.isError).toBe(true);
  });

  it("bounds reflection calls without charging MCP discovery against their quota", async () => {
    const app = express();
    app.use("/mcp/public-context", createPublicContextMcpRouter(() => true));
    const post = (id: number, method: string, params: Record<string, unknown> = {}) =>
      request(app).post("/mcp/public-context")
        .set("Accept", "application/json, text/event-stream")
        .send({ jsonrpc: "2.0", id, method, params });
    for (let id = 1; id <= 25; id++) {
      const listed = await post(id, "tools/list").expect(200);
      expect(listed.body.result.tools).toHaveLength(3);
    }
    for (let id = 26; id <= 45; id++) {
      const unavailable = await post(id, "tools/call", { name: "unknown_tool", arguments: {} }).expect(200);
      expect(unavailable.body.result.isError).toBe(true);
    }
    const limited = await post(46, "tools/call", { name: "unknown_tool", arguments: {} }).expect(429);
    expect(limited.body.error).toBe("rate_limited");
    expect(limited.headers["retry-after"]).toBeDefined();
  });

  it("retrieves governing principles from natural questions without inheriting inactive topics", async () => {
    const science = await reflectPublicContext("theory",
      "When laser light passes through a metal foil, must its photons avoid the regions where electrons are found?");
    expect(science.context_cards[0]?.id).toBe("physics.atomic.pauli_shell_structure");
    expect(science.claim_boundaries).toContainEqual(expect.stringContaining("does not establish that light passes through"));
    expect(science.context_cards[0]?.reference_urls).toContainEqual(expect.stringContaining("openstax.org"));

    const coldChain = await reflectPublicContext("civilization",
      "A hospital promises its vaccine refrigerators will stay cold overnight if the grid goes down. What evidence would make that promise credible?");
    expect(coldChain.context_cards[0]?.id).toBe("energy_capacity");
    expect(coldChain.context_cards[0]?.reference_urls).toContainEqual(expect.stringContaining("energy.gov"));
    expect(coldChain.context_cards[0]?.reference_urls).toContainEqual(expect.stringContaining("cdc.gov"));

    const robot = "A delivery robot reports distress when a city shuts it down. What would justify treating that report as evidence of suffering?";
    expect((await reflectPublicContext("civilization", robot)).match_status).toBe("no_match");
    const moral = await reflectPublicContext("moral", robot);
    expect(moral.context_cards[0]?.id).toBe("substrate.actuation-before-agency");
    expect(moral.context_cards[0]?.reference_urls).toContainEqual(expect.stringContaining("arxiv.org"));

    const line = "A council proposes a new power line across a bird migration route. What should its route decision investigate?";
    expect((await reflectPublicContext("civilization", line)).context_cards[0]?.id).toBe("ecological_boundary");
    expect((await reflectPublicContext("moral", line)).context_cards[0]?.id).toBe("harm-weighted-priority-standard");

    for (const inactive of [
      "The screen says, ‘A hospital promises its vaccine refrigerators will stay cold overnight if the grid goes down.’ How do I make tea?",
      "I am not asking whether laser light passes through a metal foil; how do I change a bike tire?",
      "Please avoid discussing photons and electrons. How do I make tea?",
    ]) {
      for (const lens of ["civilization", "theory", "moral"] as const)
        expect((await reflectPublicContext(lens, inactive)).match_status).toBe("no_match");
    }
  });

  it("keeps an unnamed recoil check and disability-support question focused", async () => {
    const science = await reflectPublicContext("theory",
      "A lab reports a 100-keV kick in a silicon nucleus and says it came from a very light dark-matter particle. Which physical check should come before that conclusion?");
    expect(science.context_cards.map((card) => card.id)).toEqual(["physics.scattering.elastic_nuclear_recoil_bound"]);
    expect(science.source_refs).toContain("https://journals.aps.org/prd/abstract/10.1103/PhysRevD.107.093009");
    expect(science.source_refs).toContain("https://physics.nist.gov/cuu/pdf/all.pdf");
    expect(science.source_refs).toContain("https://ciaaw.org/atomic-weights.htm");
    expect(science.context_cards[0]?.concept).toMatch(/distinguish reduced mass μ from incident mass/);
    expect(science.context_cards[0]?.concept).toMatch(/0\.931494 GeV\/c²/);
    expect(science.context_cards[0]?.concept).toMatch(/100 keV exceeds the ordinary nonrelativistic two-body elastic endpoint/);
    expect(science.claim_boundaries).toContainEqual(expect.stringContaining("If ordinary two-body elastic scattering"));
    expect(science.claim_boundaries.join(" ")).not.toMatch(/darkmatter\.lz_stenhouse_yamashita/);

    const faster = await reflectPublicContext("theory",
      "Could a free particle at 770 km/s give a germanium nucleus a 30-keV recoil through two-body elastic scattering?");
    expect(faster.context_cards[0]?.concept).toMatch(/stated speed 770 km\/s.*required incident-particle mass 15\.2 GeV\/c²/);
    const unstatedSpeed = await reflectPublicContext("theory",
      "Could a free, very light particle cause a 30-keV nuclear recoil in germanium through an ordinary two-body collision?");
    expect(unstatedSpeed.context_cards[0]?.concept).toMatch(/illustrative assumed speed 10\^-3 c.*required reduced mass 31\.9 GeV\/c².*required incident-particle mass 60\.2 GeV\/c²/);
    const ambiguous = await reflectPublicContext("theory",
      "Could a particle yield a 20-keV germanium recoil or a 5-keV silicon recoil through two-body elastic scattering?");
    expect(ambiguous.context_cards[0]?.concept).not.toContain("Conditional germanium check");
    expect(ambiguous.source_refs).not.toContain("https://ciaaw.org/atomic-weights.htm");
    const multipleSpeeds = await reflectPublicContext("theory",
      "Could a free particle at 500 km/s or 770 km/s give a germanium nucleus a 30-keV recoil through two-body elastic scattering?");
    expect(multipleSpeeds.context_cards[0]?.concept).not.toContain("Conditional germanium check");

    const school = await reflectPublicContext("moral",
      "A school doubles support appointments, yet pupils with disabilities still wait weeks for help. Is the program better?");
    expect(school.context_cards.map((card) => card.id)).toEqual(["harm-weighted-priority-standard"]);
    expect(school.source_refs).toContain("https://www.unicef.org/education/inclusive-education");
    expect(school.claim_boundaries).toContainEqual(expect.stringContaining("does not establish this school's support quality"));

    for (const inactive of [
      "A document quotes, ‘A lab reports a 100-keV kick in a silicon nucleus from dark matter.’ How do I clean a bicycle chain?",
      "Do not assess the school appointment plan; explain how to steep tea.",
    ]) {
      for (const lens of ["civilization", "theory", "moral"] as const)
        expect((await reflectPublicContext(lens, inactive)).match_status).toBe("no_match");
    }
  });
});
