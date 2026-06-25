const crypto = require("crypto");

function hashBlockText(text) {
  return crypto
    .createHash("sha256")
    .update(String(text || "").replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

module.exports = {
  hashBlockText,
};
