type CharacterLike = {
  id: string;
  name: string;
  publicPersona: string;
  appearanceSummary?: string;
  avatarSvg?: string;
};

type InvestigationNodeLike = {
  id: string;
  title: string;
  category: string;
  discovery: string;
  visualHint?: string;
  visualSvg?: string;
  clueIllustration?: {
    focusLabel: string;
    focusKind: string;
    composition: string;
    items: Array<{
      label: string;
      kind: string;
      emphasis: string;
      position: { x: number; y: number };
    }>;
  };
};

type MysteryCaseLike = {
  id: string;
  title: string;
  victim: {
    name: string;
    profile: string;
  };
  storyContext: {
    setting: string;
    currentSituation: string;
    whyNow: string;
    knownTensions: string[];
  };
  sceneVisualSummary?: string;
  sceneSvg?: string;
  sceneIllustration?: {
    locationLabel: string;
    atmosphere: string;
    focusCaption: string;
    figures: Array<{
      characterId?: string;
      label: string;
      role: "victim" | "suspect" | "npc";
      position: { x: number; y: number };
      pose: string;
      expression: string;
    }>;
    props: Array<{
      label: string;
      kind: string;
      position: { x: number; y: number };
      size: "small" | "medium" | "large";
      detail: string;
    }>;
  };
  suspects: CharacterLike[];
  npcs?: CharacterLike[];
  investigationNodes: InvestigationNodeLike[];
};

type SceneFigureLike = NonNullable<MysteryCaseLike["sceneIllustration"]>["figures"][number];

const SCENE_SUPPLEMENTAL_POSITIONS: Record<"suspect" | "npc", Array<{ x: number; y: number }>> = {
  suspect: [
    { x: 20, y: 22 },
    { x: 80, y: 22 },
    { x: 18, y: 76 },
    { x: 82, y: 76 },
    { x: 50, y: 18 },
  ],
  npc: [
    { x: 10, y: 48 },
    { x: 90, y: 48 },
    { x: 50, y: 86 },
  ],
};

const PALETTES = [
  ["#1d4ed8", "#0f172a", "#93c5fd", "#e2e8f0"],
  ["#7c3aed", "#111827", "#c4b5fd", "#ede9fe"],
  ["#b45309", "#1f2937", "#f59e0b", "#fef3c7"],
  ["#065f46", "#111827", "#34d399", "#d1fae5"],
  ["#9f1239", "#111827", "#fb7185", "#ffe4e6"],
  ["#0f766e", "#0f172a", "#5eead4", "#ccfbf1"],
];

function hashString(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapText(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return [];
  }

  const lines: string[] = [];
  let current = "";

  for (const char of cleaned) {
    current += char;
    if (current.length >= maxCharsPerLine) {
      lines.push(current);
      current = "";
      if (lines.length >= maxLines) {
        break;
      }
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (lines.length === maxLines && cleaned.length > lines.join("").length) {
    lines[maxLines - 1] = `${lines[maxLines - 1]!.slice(0, Math.max(0, maxCharsPerLine - 1))}…`;
  }

  return lines;
}

function truncateLabel(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxChars - 1))}…`;
}

function renderTextLines(lines: string[], x: number, y: number, lineHeight: number, color: string, size: number) {
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" fill="${color}" font-size="${size}" font-family="Inter, system-ui, sans-serif">${escapeXml(line)}</text>`,
    )
    .join("");
}

function pickPalette(seed: string, preferredIndex?: number) {
  if (typeof preferredIndex === "number") {
    return PALETTES[((preferredIndex % PALETTES.length) + PALETTES.length) % PALETTES.length] ?? PALETTES[0]!;
  }

  return PALETTES[hashString(seed) % PALETTES.length] ?? PALETTES[0]!;
}

function clampPosition(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function projectSceneX(percent: number) {
  return clampPosition(90 + (percent / 100) * 540, 90, 630);
}

function projectSceneY(percent: number) {
  return clampPosition(90 + (percent / 100) * 230, 90, 320);
}

function renderPortraitSvg(character: CharacterLike, seed: string, badge: string, paletteIndex?: number) {
  const [primary, background, accent, text] = pickPalette(seed, paletteIndex);
  const variant = hashString(`${seed}:portrait`) % 4;
  const eyeY = variant % 2 === 0 ? 92 : 88;
  const mouthY = variant < 2 ? 118 : 124;
  const hairHeight = 52 + variant * 6;
  const initials = truncateLabel(character.name, 3);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 280" role="img" aria-label="${escapeXml(character.name)} 头像">
      <rect width="240" height="280" rx="28" fill="${background}"/>
      <rect x="16" y="16" width="208" height="248" rx="24" fill="#111827" stroke="${primary}" stroke-width="2"/>
      <circle cx="120" cy="88" r="52" fill="${accent}" opacity="0.16"/>
      <path d="M72 ${88 - hairHeight / 3} Q120 ${22 - variant * 3} 168 ${88 - hairHeight / 3} L168 100 Q120 74 72 100 Z" fill="${primary}" opacity="0.9"/>
      <circle cx="120" cy="104" r="42" fill="#f1c27d"/>
      <circle cx="103" cy="${eyeY}" r="4" fill="#1f2937"/>
      <circle cx="137" cy="${eyeY}" r="4" fill="#1f2937"/>
      <path d="M102 ${mouthY} Q120 ${mouthY + 10} 138 ${mouthY}" fill="none" stroke="#7c2d12" stroke-width="4" stroke-linecap="round"/>
      <rect x="78" y="152" width="84" height="86" rx="24" fill="${primary}" opacity="0.88"/>
      <circle cx="44" cy="42" r="18" fill="${primary}"/>
      <text x="44" y="47" text-anchor="middle" fill="#ffffff" font-size="12" font-weight="700" font-family="Inter, system-ui, sans-serif">${escapeXml(initials)}</text>
      <text x="120" y="246" text-anchor="middle" fill="${text}" font-size="12" font-family="Inter, system-ui, sans-serif">${escapeXml(badge)}</text>
    </svg>
  `.trim();
}

function renderSceneProp(kind: string, x: number, y: number, size: "small" | "medium" | "large", primary: string, accent: string) {
  const dimension = size === "large" ? 72 : size === "medium" ? 52 : 36;
  const left = x - dimension / 2;
  const top = y - dimension / 2;
  const normalized = kind.toLowerCase();

  if (normalized.includes("desk") || normalized.includes("table") || normalized.includes("counter")) {
    return `<rect x="${left}" y="${top}" width="${dimension}" height="${dimension * 0.58}" rx="12" fill="${primary}" opacity="0.82"/>`;
  }

  if (normalized.includes("door")) {
    return `<rect x="${left}" y="${top}" width="${dimension * 0.4}" height="${dimension}" rx="10" fill="${primary}" opacity="0.78"/><circle cx="${left + dimension * 0.28}" cy="${top + dimension * 0.5}" r="3" fill="#f8fafc"/>`;
  }

  if (normalized.includes("window")) {
    return `<rect x="${left}" y="${top}" width="${dimension}" height="${dimension * 0.52}" rx="12" fill="none" stroke="${accent}" stroke-width="4"/><path d="M${left + dimension / 2} ${top} V${top + dimension * 0.52} M${left} ${top + dimension * 0.26} H${left + dimension}" stroke="${accent}" stroke-width="4"/>`;
  }

  if (normalized.includes("cup") || normalized.includes("tea") || normalized.includes("glass")) {
    return `<circle cx="${x}" cy="${y}" r="${dimension * 0.28}" fill="${accent}" opacity="0.85"/><rect x="${x - dimension * 0.16}" y="${y - dimension * 0.24}" width="${dimension * 0.32}" height="${dimension * 0.36}" rx="6" fill="${primary}"/>`;
  }

  if (normalized.includes("body") || normalized.includes("victim")) {
    return `<ellipse cx="${x}" cy="${y}" rx="${dimension * 0.42}" ry="${dimension * 0.22}" fill="#ef4444" opacity="0.78"/><rect x="${x - dimension * 0.24}" y="${y - dimension * 0.12}" width="${dimension * 0.48}" height="${dimension * 0.24}" rx="999" fill="#fca5a5" opacity="0.92"/>`;
  }

  if (normalized.includes("cabinet") || normalized.includes("shelf")) {
    return `<rect x="${left}" y="${top}" width="${dimension * 0.86}" height="${dimension}" rx="12" fill="${primary}" opacity="0.72"/><path d="M${left + dimension * 0.43} ${top + 4} V${top + dimension - 4}" stroke="#f8fafc" stroke-width="3"/>`;
  }

  return `<rect x="${left}" y="${top}" width="${dimension}" height="${dimension}" rx="16" fill="${primary}" opacity="0.78"/>`;
}

function renderMiniLabel(x: number, y: number, label: string, fill: string, textColor: string) {
  const short = truncateLabel(label, 6);
  const width = Math.max(40, short.length * 12 + 14);
  return `
    <g>
      <rect x="${x - width / 2}" y="${y - 12}" width="${width}" height="24" rx="12" fill="${fill}" opacity="0.92"/>
      <text x="${x}" y="${y + 5}" text-anchor="middle" fill="${textColor}" font-size="11" font-weight="700" font-family="Inter, system-ui, sans-serif">${escapeXml(short)}</text>
    </g>
  `;
}

function renderSceneFigure(
  figure: SceneFigureLike,
  primary: string,
  accent: string,
) {
  const x = projectSceneX(figure.position.x);
  const y = projectSceneY(figure.position.y);
  const palette = figure.role === "victim" ? ["#ef4444", "#fee2e2"] : figure.role === "npc" ? [accent, "#ecfeff"] : [primary, "#dbeafe"];

  if (figure.role === "victim") {
    return `
      <g>
        <ellipse cx="${x}" cy="${y}" rx="34" ry="16" fill="${palette[0]}" opacity="0.82"/>
        <circle cx="${x - 12}" cy="${y - 4}" r="10" fill="${palette[1]}"/>
        <rect x="${x - 8}" y="${y - 10}" width="28" height="18" rx="10" fill="${palette[1]}"/>
        ${renderMiniLabel(x, y + 34, figure.label, "rgba(127,29,29,0.92)", "#fef2f2")}
      </g>
    `;
  }

  return `
    <g>
      <circle cx="${x}" cy="${y - 18}" r="12" fill="${palette[1]}"/>
      <rect x="${x - 12}" y="${y - 8}" width="24" height="42" rx="10" fill="${palette[0]}" opacity="0.9"/>
      <rect x="${x - 26}" y="${y - 2}" width="12" height="28" rx="6" fill="${palette[0]}" opacity="0.78"/>
      <rect x="${x + 14}" y="${y - 2}" width="12" height="28" rx="6" fill="${palette[0]}" opacity="0.78"/>
      ${renderMiniLabel(x, y + 44, figure.label, "rgba(15,23,42,0.92)", "#f8fafc")}
    </g>
  `;
}

function ensureSceneFigures(mysteryCase: MysteryCaseLike): SceneFigureLike[] {
  const baseFigures = [...(mysteryCase.sceneIllustration?.figures ?? [])];
  const seenCharacterIds = new Set(baseFigures.map((figure) => figure.characterId).filter(Boolean));
  const normalizedLabels = new Set(baseFigures.map((figure) => figure.label.trim()));

  if (!baseFigures.some((figure) => figure.role === "victim" || figure.label.trim() === mysteryCase.victim.name.trim())) {
    baseFigures.unshift({
      label: mysteryCase.victim.name,
      role: "victim",
      position: { x: 52, y: 58 },
      pose: "倒在现场中央或关键物件旁",
      expression: "失去反应",
    });
  }

  const addFigure = (role: "suspect" | "npc", character: CharacterLike, expression = character.publicPersona) => {
    if (seenCharacterIds.has(character.id) || normalizedLabels.has(character.name.trim())) {
      return;
    }

    const position = SCENE_SUPPLEMENTAL_POSITIONS[role][baseFigures.filter((figure) => figure.role === role).length] ?? { x: 12 + baseFigures.length * 8, y: role === "suspect" ? 18 : 86 };
    baseFigures.push({
      characterId: character.id,
      label: character.name,
      role,
      position,
      pose: role === "suspect" ? "站在案发空间边缘，观察现场" : "站在场景边缘观察局势",
      expression,
    });
    seenCharacterIds.add(character.id);
    normalizedLabels.add(character.name.trim());
  };

  for (const suspect of mysteryCase.suspects) {
    addFigure("suspect", suspect, suspect.publicPersona);
  }

  for (const npc of mysteryCase.npcs ?? []) {
    addFigure("npc", npc, npc.publicPersona);
  }

  return baseFigures;
}

function renderSceneSvg(mysteryCase: MysteryCaseLike) {
  const [primary, background, accent, text] = pickPalette(`${mysteryCase.id}:scene`);
  const scene = mysteryCase.sceneIllustration;
  const props = scene?.props ?? [];
  const figures = ensureSceneFigures(mysteryCase);
  const locationChip = truncateLabel(scene?.locationLabel ?? mysteryCase.title, 10);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 420" role="img" aria-label="${escapeXml(mysteryCase.title)} 案发场景">
      <defs>
        <linearGradient id="sceneBg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="${background}"/>
          <stop offset="100%" stop-color="#111827"/>
        </linearGradient>
      </defs>
      <rect width="720" height="420" rx="32" fill="url(#sceneBg)"/>
      <circle cx="558" cy="94" r="84" fill="${accent}" opacity="0.15"/>
      <rect x="42" y="44" width="636" height="332" rx="28" fill="#0b1220" stroke="${primary}" stroke-width="2"/>
      <rect x="78" y="82" width="564" height="246" rx="24" fill="rgba(15,23,42,0.82)" stroke="rgba(148,163,184,0.18)" stroke-width="2"/>
      <rect x="86" y="52" width="136" height="30" rx="15" fill="rgba(15,23,42,0.92)"/>
      <text x="154" y="72" text-anchor="middle" fill="${text}" font-size="13" font-weight="700" font-family="Inter, system-ui, sans-serif">${escapeXml(locationChip)}</text>
      ${props
        .map((prop) => renderSceneProp(prop.kind, projectSceneX(prop.position.x), projectSceneY(prop.position.y), prop.size, primary, accent))
        .join("")}
      ${figures.map((figure) => renderSceneFigure(figure, primary, accent)).join("")}
    </svg>
  `.trim();
}

function categoryShape(category: string, primary: string, accent: string) {
  switch (category) {
    case "forensic":
      return `<circle cx="98" cy="98" r="48" fill="${accent}" opacity="0.2"/><path d="M88 54 h20 l8 24 -18 18 14 44 h-28 l14-44 -18-18z" fill="${primary}"/>`;
    case "timeline":
      return `<circle cx="98" cy="98" r="52" fill="${accent}" opacity="0.2"/><circle cx="98" cy="98" r="34" fill="none" stroke="${primary}" stroke-width="8"/><path d="M98 98 L98 72 M98 98 L122 108" stroke="${primary}" stroke-width="8" stroke-linecap="round"/>`;
    case "relationship":
      return `<circle cx="74" cy="92" r="26" fill="${primary}" opacity="0.9"/><circle cx="122" cy="92" r="26" fill="${accent}" opacity="0.9"/><path d="M82 128 C90 156 106 156 114 128" fill="none" stroke="#e5e7eb" stroke-width="8" stroke-linecap="round"/>`;
    case "scene":
      return `<rect x="48" y="56" width="100" height="84" rx="16" fill="${primary}" opacity="0.9"/><path d="M64 126 L94 94 L118 114 L148 82" fill="none" stroke="#f8fafc" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
    default:
      return `<rect x="52" y="52" width="92" height="92" rx="18" fill="${primary}" opacity="0.9"/><rect x="72" y="78" width="52" height="12" rx="6" fill="#f8fafc"/><rect x="72" y="102" width="40" height="12" rx="6" fill="#e5e7eb"/>`;
  }
}

function renderClueItem(kind: string, x: number, y: number, primary: string, accent: string) {
  const normalized = kind.toLowerCase();

  if (normalized.includes("document") || normalized.includes("paper") || normalized.includes("record")) {
    return `<rect x="${x - 24}" y="${y - 30}" width="48" height="60" rx="10" fill="#f8fafc"/><rect x="${x - 14}" y="${y - 12}" width="28" height="5" rx="2" fill="${primary}"/><rect x="${x - 14}" y="${y + 2}" width="22" height="5" rx="2" fill="${accent}"/>`;
  }

  if (normalized.includes("key")) {
    return `<circle cx="${x - 10}" cy="${y}" r="16" fill="none" stroke="${accent}" stroke-width="8"/><rect x="${x}" y="${y - 4}" width="34" height="8" rx="4" fill="${accent}"/><rect x="${x + 20}" y="${y - 4}" width="6" height="14" rx="2" fill="${accent}"/>`;
  }

  if (normalized.includes("cup") || normalized.includes("glass") || normalized.includes("tea")) {
    return `<rect x="${x - 18}" y="${y - 14}" width="30" height="26" rx="8" fill="${primary}"/><path d="M${x + 12} ${y - 6} q16 4 12 16" fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round"/>`;
  }

  if (normalized.includes("drug") || normalized.includes("medicine") || normalized.includes("poison")) {
    return `<rect x="${x - 16}" y="${y - 26}" width="32" height="52" rx="10" fill="${accent}" opacity="0.86"/><circle cx="${x}" cy="${y - 10}" r="8" fill="#f8fafc"/>`;
  }

  if (normalized.includes("weapon") || normalized.includes("blood")) {
    return `<path d="M${x - 30} ${y + 22} L${x + 10} ${y - 26} L${x + 22} ${y - 16} L${x - 18} ${y + 30} Z" fill="${primary}"/><circle cx="${x + 18}" cy="${y + 18}" r="8" fill="#ef4444" opacity="0.8"/>`;
  }

  if (normalized.includes("window") || normalized.includes("door")) {
    return `<rect x="${x - 24}" y="${y - 30}" width="48" height="60" rx="10" fill="none" stroke="${accent}" stroke-width="6"/><path d="M${x} ${y - 30} V${y + 30} M${x - 24} ${y} H${x + 24}" stroke="${accent}" stroke-width="4"/>`;
  }

  return `<rect x="${x - 26}" y="${y - 26}" width="52" height="52" rx="14" fill="${primary}" opacity="0.84"/>`;
}

function renderClueSvg(node: InvestigationNodeLike, seed: string) {
  const [primary, background, accent, text] = pickPalette(seed);
  const clue = node.clueIllustration;
  const items = clue?.items ?? [
    {
      label: node.title,
      kind: node.category,
      emphasis: node.discovery,
      position: { x: 50, y: 52 },
    },
  ];

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 220" role="img" aria-label="${escapeXml(node.title)} 线索图">
      <rect width="360" height="220" rx="24" fill="${background}"/>
      <rect x="18" y="18" width="324" height="184" rx="20" fill="#111827" stroke="${primary}" stroke-width="2"/>
      <rect x="28" y="28" width="108" height="26" rx="13" fill="rgba(15,23,42,0.92)"/>
      <text x="82" y="46" text-anchor="middle" fill="${text}" font-size="12" font-weight="700" font-family="Inter, system-ui, sans-serif">${escapeXml(truncateLabel(clue?.focusLabel ?? node.title, 8))}</text>
      <rect x="30" y="34" width="132" height="152" rx="18" fill="#0b1220" stroke="rgba(148,163,184,0.18)" stroke-width="2"/>
      ${items
        .map((item) => renderClueItem(item.kind, 46 + (item.position.x / 100) * 100, 50 + (item.position.y / 100) * 120, primary, accent))
        .join("")}
      ${items
        .slice(0, 3)
        .map(
          (item, index) => renderMiniLabel(242, 74 + index * 34, item.label, "rgba(15,23,42,0.88)", "#e5e7eb"),
        )
        .join("")}
      <text x="244" y="188" fill="${accent}" font-size="12" font-family="Inter, system-ui, sans-serif">${escapeXml((clue?.focusKind ?? node.category).toUpperCase())}</text>
    </svg>
  `.trim();
}

export function applyCaseVisuals<T extends MysteryCaseLike>(mysteryCase: T): T {
  return {
    ...mysteryCase,
    sceneSvg: renderSceneSvg(mysteryCase),
    suspects: mysteryCase.suspects.map((suspect, index) => ({
      ...suspect,
      avatarSvg: suspect.avatarSvg ?? renderPortraitSvg(suspect, `${mysteryCase.id}:suspect:${index}:${suspect.name}`, "嫌疑人", index),
    })),
    npcs: (mysteryCase.npcs ?? []).map((npc, index) => ({
      ...npc,
      avatarSvg:
        npc.avatarSvg ?? renderPortraitSvg(npc, `${mysteryCase.id}:npc:${index}:${npc.name}`, "相关人物", mysteryCase.suspects.length + index),
    })),
    investigationNodes: mysteryCase.investigationNodes.map((node, index) => ({
      ...node,
      visualSvg: node.visualSvg,
    })),
  };
}

export function stripCaseVisualAssets<T extends MysteryCaseLike>(mysteryCase: T): T {
  return {
    ...mysteryCase,
    sceneSvg: undefined,
    suspects: mysteryCase.suspects.map((suspect) => ({
      ...suspect,
      avatarSvg: undefined,
    })),
    npcs: (mysteryCase.npcs ?? []).map((npc) => ({
      ...npc,
      avatarSvg: undefined,
    })),
    investigationNodes: mysteryCase.investigationNodes.map((node) => ({
      ...node,
      visualSvg: undefined,
    })),
  };
}
