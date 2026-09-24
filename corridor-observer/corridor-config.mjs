export const CORRIDOR_ID = "n3-south-xindian-yangmei";
export const CORRIDOR_LABEL = "國道 3 號南向｜新店至楊梅";

// Fixed mainline cameras only. Interchange ramps and auxiliary-road cameras are intentionally excluded.
export const CORRIDOR_CAMERAS = [
  { id: "CCTV-N3-S-27.900-M", mile: "27K+900", label: "新店隧道路段" },
  { id: "CCTV-N3-S-32.940-M", mile: "32K+940", label: "安坑以南主線" },
  { id: "CCTV-N3-S-35.900-M", mile: "35K+900", label: "中和主線" },
  { id: "CCTV-N3-S-40.980-M", mile: "40K+980", label: "土城以南主線" },
  { id: "CCTV-N3-S-46.470-M", mile: "46K+470", label: "樹林主線" },
  { id: "CCTV-N3-S-49.730-M", mile: "49K+730", label: "三鶯主線" },
  { id: "CCTV-N3-S-54.400-M", mile: "54K+400", label: "鶯歌系統以南主線" },
  { id: "CCTV-N3-S-60.500-M", mile: "60K+500", label: "大溪以北主線" },
  { id: "CCTV-N3-S-65.450-M", mile: "65K+450", label: "大溪以南主線" },
  { id: "CCTV-N3-S-70.300-M", mile: "70K+300", label: "龍潭以北主線" },
];

export function isMainlineCorridorCamera(camera) {
  return /^CCTV-N3-S-\d/.test(camera?.id || "") && !/-(?:I|O)-/.test(camera?.id || "");
}

export function kilometerFromMile(value) {
  const match = String(value || "").match(/^(\d+)K\+(\d{3})$/i);
  return match ? Number(match[1]) + Number(match[2]) / 1000 : NaN;
}
