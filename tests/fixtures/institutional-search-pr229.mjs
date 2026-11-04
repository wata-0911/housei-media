// Frozen PR #229 comparison baseline (c71a53f); intentionally independent of shared UI.
// #104 presentation comparison only; never an official identity decision.
var normalize = function (value) { return value.normalize('NFKC').toLocaleLowerCase('ja').trim(); };
export function filterPlacementNames(rows, query, mode) {
    var needle = normalize(query);
    if (!needle)
        return rows;
    var terms = needle.split(/\s+/);
    return rows.filter(function (_a) {
        var placement = _a.placement;
        var name = normalize(placement.officialName);
        return mode === 'exact' ? name === needle : terms.every(function (term) { return name.includes(term); });
    });
}
export var compositionLabel = function (credits) { return credits === null ? '不明（null）' : "".concat(credits, "\u5358\u4F4D"); };
