// The six verified live cameras. These entries are copied unchanged from the
// original Skim_Cams_Pirate_View_v1_1.html — do not edit a camera without
// re-verifying its live player.
export const cams=[{"spot": "Dewey", "name": "Dewey Beach", "kind": "iframe", "src": "https://v.angelcam.com/iframe?autoplay=1&v=27r3vv4pyx", "note": "Oceanfront"}, {"spot": "Indian River", "name": "Inlet North", "kind": "hls", "src": "https://video.deldot.gov/live/SCAM098.stream/playlist.m3u8", "note": "North side"}, {"spot": "Indian River", "name": "Inlet Overview", "kind": "hls", "src": "https://video.deldot.gov/live/SCAM169.stream/playlist.m3u8", "note": "South pylon"}, {"spot": "Bethany", "name": "Bethany Ocean", "kind": "iframe", "src": "https://v.angelcam.com/iframe?autoplay=1&v=boykze68y8", "note": "East / ocean"}, {"spot": "Bethany", "name": "Bethany North", "kind": "iframe", "src": "https://v.angelcam.com/iframe?autoplay=1&v=v8yp6jmpr6", "note": "North view"}, {"spot": "Bethany", "name": "Bethany South", "kind": "iframe", "src": "https://v.angelcam.com/iframe?autoplay=1&v=ger25k77rm", "note": "South view"}];

// Ocean City, MD — official YouTube Live players. Both streams' owners allow embedding
// (YouTube oEmbed 200 / playableInEmbed true, verified 2026-11-22). Shown in YouTube's own
// unmodified player: no PIRATE VIEW bug over it, YouTube branding left as is.
cams.push(
  { spot: 'Ocean City', name: 'Commander Hotel 14th St', kind: 'youtube', src: 'https://www.youtube.com/embed/zCEiot7sEWY?autoplay=1&mute=1&playsinline=1&rel=0', href: 'https://www.youtube.com/watch?v=zCEiot7sEWY', note: 'Gateway Subaru Camera at The Commander Hotel · 14th St & Boardwalk · YouTube Live' },
  { spot: 'Ocean City', name: 'Econo Lodge 29th St', kind: 'youtube', src: 'https://www.youtube.com/embed/zGima24vRHM?autoplay=1&mute=1&playsinline=1&rel=0', href: 'https://www.youtube.com/watch?v=zGima24vRHM', note: 'Econo Lodge Oceanfront · 2910 Baltimore Ave (29th St) · YouTube Live' },
);

// Legacy direct-link slug (e.g. #dewey-beach, #inlet-north) — same rule as the original file.
export const camSlug = c => c.name.toLowerCase().replaceAll(' ', '-');
