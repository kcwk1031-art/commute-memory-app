const DESTINATION_PROFILES = [
  {
    id: "yangmei",
    matches: /楊梅/,
    target: { lat: 24.909, lng: 121.145 },
    corridors: {
      S: ["N3", "N1"],
      N: ["N3", "N1"],
    },
  },
  {
    id: "xindian",
    matches: /新店/,
    target: { lat: 24.967, lng: 121.541 },
    corridors: {
      S: ["N3", "N1"],
      N: ["N3", "N1"],
    },
  },
];

function directionLabel(direction) {
  return ({ N: "北上", S: "南下" })[direction] || "方向待確認";
}

function corridorLabel(corridors, direction) {
  const roads = corridors.map((route) => `國道${route.slice(1)}號`).join("／");
  return `${roads} ${directionLabel(direction)}`;
}

// A destination name is only a hint. Use it to warm likely freeway data, never to confirm the active roadway.
export function resolveDestinationIntent(destination, point) {
  const profile = DESTINATION_PROFILES.find((candidate) => candidate.matches.test(String(destination || "")));
  if (!profile || !Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return null;

  const latitudeDelta = point.lat - profile.target.lat;
  if (Math.abs(latitudeDelta) < 0.035) return null;
  const direction = latitudeDelta > 0 ? "S" : "N";
  const routes = profile.corridors[direction] || [];
  if (!routes.length) return null;

  return {
    profileId: profile.id,
    direction,
    directionLabel: directionLabel(direction),
    routes,
    corridorLabel: corridorLabel(routes, direction),
  };
}
