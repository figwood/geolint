export function dbf(fields, rows, {driver=0,deleted=[]}={}) {
  const header=33+32*fields.length, length=1+fields.reduce((n,f)=>n+f.length,0);
  const bytes=new Uint8Array(header+length*rows.length+1), view=new DataView(bytes.buffer);
  bytes[0]=3; bytes[29]=driver; view.setUint32(4,rows.length,true); view.setUint16(8,header,true); view.setUint16(10,length,true);
  fields.forEach((f,i)=>{const offset=32+i*32;bytes.set(new TextEncoder().encode(f.name),offset);bytes[offset+11]=f.type.charCodeAt(0);bytes[offset+16]=f.length;bytes[offset+17]=f.decimals??0;});
  bytes[header-1]=13;
  rows.forEach((row,i)=>{let offset=header+i*length;bytes[offset++]=deleted.includes(i)?42:32;for(const f of fields){bytes.fill(32,offset,offset+f.length);const value=row[f.name];const raw=value instanceof Uint8Array?value:new TextEncoder().encode(value??'');if(raw.length>f.length)throw new Error('Fixture value too long');bytes.set(raw,offset);offset+=f.length;}});
  bytes[bytes.length-1]=26;return bytes;
}
