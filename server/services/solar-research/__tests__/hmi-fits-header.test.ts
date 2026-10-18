import {expect,it} from 'vitest';
import {inspectHmiFitsHeader} from '../hmi-fits-header';

function fixture(quality='1024'){
  const bytes=Buffer.alloc(5760,0x20);
  function write(block:number,cards:string[]){
    cards.forEach((card,index)=>bytes.write(card.padEnd(80,' '),block*2880+index*80,'ascii'));
  }
  write(0,['SIMPLE  = T','NAXIS   = 0','END']);
  write(1,["XTENSION= 'BINTABLE'","ZIMAGE  = T","CONTENT = 'MAGNETOGRAM'",
    "TELESCOP= 'SDO/HMI'","INSTRUME= 'HMI_FRONT2'","BUNIT   = 'Gauss'",
    "CTYPE1  = 'HPLN-TAN'","CTYPE2  = 'HPLT-TAN'",
    "DATE-OBS= '2026-09-28T20:23:01.400'",`QUALITY = ${quality}`,
    "DRMS_ID = 'lm_jps.m45s_nrt:11120854:magnetogram'",'END']);
  return bytes;
}

it('extracts only a numeric HMI extension quality flag and UTC header time',()=>{
  expect(inspectHmiFitsHeader(fixture())).toEqual({hduIndex:1,
    extensionType:'compressed_binary_table_image',observedAtUtc:'2026-09-28T20:23:01.400Z',
    qualityFlag:1024,drmsId:'lm_jps.m45s_nrt:11120854:magnetogram',
    qualityInterpretation:'numeric_flag_only_not_science_admission'});
});
it('rejects an unsupported or missing quality flag without admitting an image',()=>{
  expect(()=>inspectHmiFitsHeader(fixture(''))).toThrow('HMI_FITS_TIME_OR_QUALITY_UNAVAILABLE');
  const bytes=fixture();bytes.write("XTENSION= 'IMAGE   '".padEnd(80,' '),2880,'ascii');
  expect(()=>inspectHmiFitsHeader(bytes)).toThrow('HMI_FITS_EXTENSION_UNSUPPORTED');
});
it('leaves an absent DRMS identifier explicitly unavailable',()=>{
  const bytes=fixture();
  const offset=2880+10*80;
  bytes.write(' '.repeat(80),offset,'ascii');
  expect(inspectHmiFitsHeader(bytes).drmsId).toBeNull();
});
