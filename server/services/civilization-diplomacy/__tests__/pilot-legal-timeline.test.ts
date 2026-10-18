import { describe, expect, it } from "vitest";
import { readUnga81PairEvidence } from "../unga81-evidence";
import { composeCivilizationRelationshipNetwork } from "../relationship-network";

describe("Civilization pilot legal timeline", () => {
  it("keeps the Armenia–U.S. signature and later implementation stages conditional", () => {
    const pair = readUnga81PairEvidence({ firstCountryIso3: "ARM", secondCountryIso3: "AZE" });
    const framework = pair.dependentGovernmentEvidence.records.find((record) =>
      record.id === "arm-usa-2026-tripp-framework");

    expect(framework).toMatchObject({
      eventDate: "2026-06-04",
      parties: ["ARM", "USA"],
      legalStatus: "entry_into_force_unverified",
      statusAsOf: "2026-09-24",
    });
    expect(framework?.milestones?.map((milestone) => [milestone.date, milestone.kind])).toEqual([
      ["2026-05-26", "text_published"],
      ["2026-06-01", "first_party_signed"],
      ["2026-06-04", "both_parties_signed"],
      ["2026-08-24", "ratification_pending_reported"],
      ["2026-09-17", "implementation_documents_in_preparation"],
      ["2026-09-24", "ratification_pending_reported"],
    ]);

    const network = composeCivilizationRelationshipNetwork({
      firstCountryIso3: "ARM", secondCountryIso3: "AZE", year: 2024,
    }, pair, null);
    const relation = network.relations.find((item) => item.id === framework?.id);
    expect(relation).toMatchObject({
      relationKind: "dependent_government_framework",
      applicability: "only_if_project_uses_framework",
      legalStatus: "entry_into_force_unverified",
      statusAsOf: "2026-09-24",
    });
    expect(relation?.milestones).toEqual(framework?.milestones);
    expect(network.assessedCooperation).toBe("unassessed");
  });
});
