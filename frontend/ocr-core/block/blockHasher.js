const { hashBlockText } = require("../patch/blockHasher");

function hashBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    return "no-bbox";
  }
  const normalized = bbox.map((value) => {
    const number = Number(value);
    return Number.isFinite(number) ? (Math.round(number * 10) / 10).toFixed(1) : "nan";
  });
  return `bb_${hashBlockText(normalized.join(",")).slice(0, 12)}`;
}

module.exports = {
  hashBlockText,
  hashBbox,
};
