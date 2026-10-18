import { describe, expect, it } from "vitest";
import {
  parseSpaceEngineSteamManifest,
  parseSteamLibraryPaths,
} from "../steam-installation";

describe("SpaceEngine Steam installation parsing", () => {
  it("discovers configured library paths, including a non-primary drive", () => {
    const libraries = parseSteamLibraryPaths(String.raw`"libraryfolders"
{
  "0" { "path" "C:\\Program Files (x86)\\Steam" }
  "1" { "path" "J:\\SteamLibrary" }
}`);
    expect(libraries).toEqual([
      "C:\\Program Files (x86)\\Steam",
      "J:\\SteamLibrary",
    ]);
  });

  it("accepts only the exact app and a safe installation-directory component", () => {
    expect(parseSpaceEngineSteamManifest(`"appid" "314650"\n"installdir" "SpaceEngine"\n"buildid" "19191665"\n"TargetBuildID" "24591999"`))
      .toEqual({ installDir: "SpaceEngine", buildId: "19191665", targetBuildId: "24591999" });
    expect(parseSpaceEngineSteamManifest(`"appid" "1"\n"installdir" "SpaceEngine"`)).toBeNull();
    expect(parseSpaceEngineSteamManifest(`"appid" "314650"\n"installdir" "..\\OtherGame"`)).toBeNull();
  });
});
