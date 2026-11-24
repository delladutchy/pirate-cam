// Keep a full-view canvas glued to the map during Leaflet's zoom animation (scale + offset, the
// same way Leaflet animates image overlays), so layers don't blink while zooming.
export function animateWithZoom(map, L, canvas) {
  let bounds = null;
  canvas.classList.add('leaflet-zoom-animated');
  const mark = () => { bounds = map.getBounds(); };
  map.on('zoomanim', e => {
    if (!bounds || !map._latLngBoundsToNewLayerBounds) return;
    const scale = map.getZoomScale(e.zoom), offset = map._latLngBoundsToNewLayerBounds(bounds, e.zoom, e.center).min;
    L.DomUtil.setTransform(canvas, offset, scale);
  });
  return mark; // call after every redraw (records which view the canvas shows)
}
