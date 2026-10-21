export function bindFileDrop(zone, input, selectFile) {
  const clearDragging = () => { delete zone.dataset.dragging; };
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', event => {
    event.preventDefault();
    zone.dataset.dragging = 'true';
  });
  zone.addEventListener('dragleave', clearDragging);
  zone.addEventListener('drop', event => {
    event.preventDefault();
    clearDragging();
    const file = event.dataTransfer?.files?.[0];
    if (file) selectFile(file);
  });
}
