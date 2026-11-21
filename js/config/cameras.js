// The six verified live cameras. These entries are copied unchanged from the
// original Skim_Cams_Pirate_View_v1_1.html — do not edit a camera without
// re-verifying its live player.
export const cams=[{"spot": "Dewey", "name": "Dewey Beach", "kind": "iframe", "src": "https://v.angelcam.com/iframe?autoplay=1&v=27r3vv4pyx", "note": "Oceanfront"}, {"spot": "Indian River", "name": "Inlet North", "kind": "hls", "src": "https://video.deldot.gov/live/SCAM098.stream/playlist.m3u8", "note": "North side"}, {"spot": "Indian River", "name": "Inlet Overview", "kind": "hls", "src": "https://video.deldot.gov/live/SCAM169.stream/playlist.m3u8", "note": "South pylon"}, {"spot": "Bethany", "name": "Bethany Ocean", "kind": "iframe", "src": "https://v.angelcam.com/iframe?autoplay=1&v=boykze68y8", "note": "East / ocean"}, {"spot": "Bethany", "name": "Bethany North", "kind": "iframe", "src": "https://v.angelcam.com/iframe?autoplay=1&v=v8yp6jmpr6", "note": "North view"}, {"spot": "Bethany", "name": "Bethany South", "kind": "iframe", "src": "https://v.angelcam.com/iframe?autoplay=1&v=ger25k77rm", "note": "South view"}];

// Legacy direct-link slug (e.g. #dewey-beach, #inlet-north) — same rule as the original file.
export const camSlug = c => c.name.toLowerCase().replaceAll(' ', '-');
