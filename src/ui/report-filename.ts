export function reportFileName(inputFileName: string, format: 'csv' | 'json'): string {
  const baseName = inputFileName.replace(/\.(?:geojson|json|shp|zip)$/i, '');
  return `${baseName}_check_result.${format}`;
}
