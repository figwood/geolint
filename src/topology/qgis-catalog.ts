import type { Geometry } from '../contracts.ts';
import type { RuleFamily } from '../diagnostics.ts';

export const pointTypes: readonly Geometry['type'][] = ['Point', 'MultiPoint'];
export const lineTypes: readonly Geometry['type'][] = ['LineString', 'MultiLineString'];
export const areaTypes: readonly Geometry['type'][] = ['Polygon', 'MultiPolygon'];
export const linearTypes = [...lineTypes, ...areaTypes];
export const simpleTypes = [...pointTypes, ...lineTypes, ...areaTypes];
export interface QgisRuleDefinition {
  id: string; title: string; description: string; family: RuleFamily; code: string;
  types: readonly Geometry['type'][]; precision: boolean;
  fields: Readonly<Record<string, { min: number; max?: number; exclusive?: boolean; default?: number; unit: string }>>;
  measurements: readonly string[];
}
// IDs are permanent assignments, independent of UI category and execution order.
export const qgisRules: readonly QgisRuleDefinition[] = [
  {id:'Rule-024',title:'Must not self-intersect',family:'geometry',code:'QGIS_SELF_INTERSECTION',types:linearTypes,precision:true,fields:{},measurements:[],description:'Report each self-intersection within a line part or polygon ring. This additional constraint also applies to GEOS-valid lines.'},
  {id:'Rule-025',title:'Must not have duplicate nodes',family:'geometry',code:'QGIS_DUPLICATE_NODE',types:linearTypes,precision:true,fields:{},measurements:[],description:'Report adjacent nodes within tolerance; the closing ring coordinate is not an extra node.'},
  {id:'Rule-026',title:'Must not self-contact',family:'geometry',code:'QGIS_SELF_CONTACT',types:linearTypes,precision:true,fields:{},measurements:[],description:'Report each node touching a non-adjacent segment of the same part or ring.'},
  {id:'Rule-027',title:'Polygon rings must have at least three nodes',family:'validity',code:'QGIS_DEGENERATE_POLYGON',types:areaTypes,precision:false,fields:{},measurements:['nodeCount'],description:'Count ring nodes without the closing coordinate. Parsing failures remain failures; safe short-ring evidence can still be checked.'},
  {id:'Rule-028',title:'Polygons must not have holes',family:'geometry',code:'QGIS_POLYGON_HOLE',types:areaTypes,precision:false,fields:{},measurements:[],description:'Report every interior ring as an additional geometry constraint.'},
  {id:'Rule-029',title:'Multipart geometries must contain more than one part',family:'geometry',code:'QGIS_SINGLE_PART_MULTIPART',types:['MultiPoint','MultiLineString','MultiPolygon'],precision:false,fields:{},measurements:['partCount'],description:'Report Multi geometries containing only one part. This is the inverse of Rule-013.'},
  {id:'Rule-030',title:'Lines must not have dangles (Geometry Checker)',family:'topology',code:'QGIS_DANGLE',types:lineTypes,precision:true,fields:{},measurements:[],description:'Each line part endpoint must lie on another line or a non-adjacent segment of itself. Interior connections count, unlike Rule-014.'},
  {id:'Rule-031',title:'Segments must meet the minimum length',family:'geometry',code:'QGIS_SHORT_SEGMENT',types:linearTypes,precision:true,fields:{minLength:{min:0,exclusive:true,unit:'coordinate units'}},measurements:['length','minLength'],description:'Report segments longer than tolerance but strictly shorter than the configured minimum; no unit conversion.'},
  {id:'Rule-032',title:'Angles must meet the minimum angle',family:'geometry',code:'QGIS_SMALL_ANGLE',types:linearTypes,precision:true,fields:{minAngle:{min:0,max:180,exclusive:true,unit:'degrees'}},measurements:['angle','minAngle'],description:'Report computable vertex angles strictly smaller than the minimum angle.'},
  {id:'Rule-033',title:'Polygons must meet the minimum area',family:'geometry',code:'QGIS_SMALL_AREA',types:areaTypes,precision:false,fields:{minArea:{min:0,exclusive:true,unit:'square coordinate units'}},measurements:['area','minArea'],description:'Report polygon parts with net area strictly below the minimum; subtract holes.'},
  {id:'Rule-034',title:'Polygons must not be slivers',family:'geometry',code:'QGIS_SLIVER_POLYGON',types:areaTypes,precision:false,fields:{maxThinness:{min:0,exclusive:true,unit:'dimensionless'},maxArea:{min:0,default:0,unit:'square coordinate units; 0 = unlimited'}},measurements:['thinness','area','maxThinness','maxArea'],description:'Thinness is the square of the larger bounding-box dimension divided by area. Report values above the threshold; optional maximum area, 0 means unlimited.'},
  {id:'Rule-035',title:'Must not have duplicate features (Geometry Checker)',family:'topology',code:'QGIS_DUPLICATE_FEATURE',types:simpleTypes,precision:true,fields:{},measurements:[],description:'Compare at configured precision and report each source with its preceding duplicate members, rather than one issue per unordered pair.'},
  {id:'Rule-036',title:'Features must not be contained in other features',family:'topology',code:'QGIS_CONTAINED_FEATURE',types:simpleTypes,precision:true,fields:{},measurements:[],description:'Report directed containment between eligible features of the same geometry family.'},
  {id:'Rule-037',title:'Polygon overlaps must not be smaller than the threshold',family:'topology',code:'QGIS_SMALL_OVERLAP',types:areaTypes,precision:true,fields:{maxArea:{min:0,default:0,unit:'square coordinate units; 0 = unlimited'}},measurements:['area','maxArea'],description:'Report overlapping intersection components above the QGIS reduced tolerance and strictly below maxArea; 0 disables the upper bound. Containment and equality do not overlap.'},
  {id:'Rule-038',title:'Polygon gaps must not be smaller than the threshold',family:'topology',code:'QGIS_SMALL_GAP',types:areaTypes,precision:true,fields:{maxArea:{min:0,default:0,unit:'square coordinate units; 0 = unlimited'}},measurements:['area','maxArea'],description:'Report enclosed coverage gaps within the configured area bound. Covered islands are excluded; exterior space is not a gap.'},
  {id:'Rule-039',title:'Lines must not intersect other line parts',family:'topology',code:'QGIS_LINE_INTERSECTION',types:lineTypes,precision:true,fields:{},measurements:[],description:'Report intersections between different line parts, including parts of the same feature. Single-part self-intersections use Rule-024.'},
  {id:'Rule-040',title:'Geometry types must match the allowed types',family:'geometry',code:'QGIS_DISALLOWED_GEOMETRY_TYPE',types:simpleTypes,precision:false,fields:{},measurements:[],description:'Require a nonempty configured subset of the six non-collection geometry types; this is independent of supported input types.'},
];
