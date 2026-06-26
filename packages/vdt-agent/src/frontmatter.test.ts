import { describe, expect, it } from "vitest";
import { parseFrontmatter, parseSkillMarkdown } from "./index";

describe("parseFrontmatter", () => {
  it("parses scalar and list values from skill frontmatter", () => {
    const parsed = parseFrontmatter(`---
id: mining.production_volume
title: Mining production volume decomposition
domain: mining
version: 1
patterns:
  - production volume
  - ore mined
kpi_patterns:
  - ore loaded
requires:
  - calendar_time
outputs:
  - production_volume
questions:
  - What time period should the KPI use?
---

# Mining Production Volume Decomposition
`);

    expect(parsed.attributes.id).toBe("mining.production_volume");
    expect(parsed.attributes.version).toBe(1);
    expect(parsed.attributes.patterns).toEqual(["production volume", "ore mined"]);
    expect(parsed.body).toContain("# Mining Production Volume Decomposition");
  });

  it("normalizes required skill frontmatter fields", () => {
    const skill = parseSkillMarkdown(
      "mining/production-volume.md",
      `---
id: mining.production_volume
title: Mining production volume decomposition
domain: mining
version: 1
patterns:
  - production volume
kpi_patterns:
  - ore mined
requires:
  - calendar_time
outputs:
  - production_volume
questions:
  - What time period should the KPI use?
---

# Mining Production Volume Decomposition
`
    );

    expect(skill.id).toBe("mining.production_volume");
    expect(skill.frontmatter.kpiPatterns).toEqual(["ore mined"]);
    expect(skill.path).toBe("mining/production-volume.md");
  });

  it("rejects empty required frontmatter lists", () => {
    expect(() =>
      parseSkillMarkdown(
        "mining/empty.md",
        `---
id: mining.empty
title: Empty mining skill
domain: mining
patterns:
kpi_patterns:
  - ore mined
requires:
  - calendar_time
outputs:
  - production_volume
questions:
  - What period?
---

# Empty
`
      )
    ).toThrow("must define at least one value for frontmatter list: patterns");
  });
});
