// Keep a full-view canvas glued to the map while the zoom changes — during a pinch (Leaflet moves
// the map live and fires 'zoom', but no 'zoomanim') and during zoom animations (buttons, double
// tap, and the snap at the end of a pinch). The canvas holds a drawing made at one zoom (z0) over
// one view (bounds); it is moved and scaled from THAT drawing, so imagery, markers and the
// forecast field never drift apart. Redrawn sharp at moveend by its owner.
export function animateWithZoom(map, L, canvas) {
  let bounds = null, z0 = null;
  canvas.classList.add('leaflet-zoom-animated');
  const mark = () => { bounds = map.getBounds(); z0 = map.getZoom(); L.DomUtil.setTransform(canvas, map.containerPointToLayerPoint([0, 0]), 1); };
  // animated zoom: where the drawn view will sit at the target zoom, scaled from the drawing's zoom
  map.on('zoomanim', e => {
    if (!bounds || !map._latLngBoundsToNewLayerBounds) return;
    L.DomUtil.setTransform(canvas, map._latLngBoundsToNewLayerBounds(bounds, e.zoom, e.center).min, map.getZoomScale(e.zoom, z0));
  });
  // live zoom (pinch): follow the fingers frame by frame
  map.on('zoom', () => {
    if (!bounds || map._animatingZoom) return;
    L.DomUtil.setTransform(canvas, map.latLngToLayerPoint(bounds.getNorthWest()), map.getZoomScale(map.getZoom(), z0));
  });
  return mark; // call after every redraw (records which view the canvas shows)
}
