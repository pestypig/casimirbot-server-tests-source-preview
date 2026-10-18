import {expect,it,vi} from 'vitest';
import {createSdoLivePreviewService} from '../sdo-live-preview';

const jpeg=Uint8Array.from([0xff,0xd8,0xff,0xe0,1,2,3,0xff,0xd9]);
const png=Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3]);
const response=(bytes:Uint8Array,mime:string,modified:string)=>new Response(bytes,
  {headers:{'Content-Type':mime,'Last-Modified':modified}});
const now=Date.parse('2026-09-30T10:01:00Z');
const old='Mon, 21 Sep 2026 15:43:10 GMT',fresh='Wed, 30 Sep 2026 10:00:00 GMT';

it('selects fresh NOAA SUVI 195 Å over a stale SDO AIA 193 Å browse file',async()=>{
  const fetcher=vi.fn(async(url:string)=>url.includes('sdo.gsfc.nasa.gov')
    ?response(jpeg,'image/jpeg',old):response(png,'image/png',fresh)) as unknown as typeof fetch;
  const service=createSdoLivePreviewService({fetcher,now:()=>now});
  const result=await service.latest('aia193');
  expect(result).toMatchObject({channel:'aia193',source:'NOAA/SWPC SUVI primary',
    sourceId:'suvi-primary',label:'SUVI 195 Å',wavelength_A:195,
    selectionReason:'preferred_stale',stale:false,observationAt:null,
    scienceRunAllowed:false,quantitativeComparisonAllowed:false});
  expect(result.sourceUrl).toBe('https://services.swpc.noaa.gov/images/animations/suvi/primary/195/latest.png');
  expect(service.image('aia193','suvi-primary',result.sha256)).toEqual({bytes:Buffer.from(png),mime:'image/png'});
  expect(service.image('aia193','sdo',result.sha256)).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('uses secondary SUVI only after primary is stale and never substitutes SUVI for HMI',async()=>{
  const fetcher=vi.fn(async(url:string)=>url.includes('sdo.gsfc.nasa.gov')
    ?response(jpeg,'image/jpeg',old):response(png,'image/png',url.includes('/primary/')?old:fresh)) as unknown as typeof fetch;
  const service=createSdoLivePreviewService({fetcher,now:()=>now});
  expect(await service.latest('aia171')).toMatchObject({sourceId:'suvi-secondary',
    label:'SUVI 171 Å',stale:false});
  expect(await service.latest('hmiMag')).toMatchObject({sourceId:'sdo',stale:true,
    selectionReason:'no_fresh_compatible_source'});
  expect(fetcher).toHaveBeenCalledTimes(5);
});

it('labels the newest dated image as stale when no source qualifies as fresh',async()=>{
  const fetcher=vi.fn(async(url:string)=>url.includes('sdo.gsfc.nasa.gov')
    ?response(jpeg,'image/jpeg',old):response(png,'image/png',
      url.includes('/primary/')?'Tue, 29 Sep 2026 10:00:00 GMT':old)) as unknown as typeof fetch;
  const result=await createSdoLivePreviewService({fetcher,now:()=>now}).latest('aia193');
  expect(result).toMatchObject({sourceId:'suvi-primary',stale:true,
    selectionReason:'no_fresh_compatible_source',observationAt:null});
});

it('uses fresh SUVI with an explicit unavailable-primary reason when SDO fetch fails',async()=>{
  const fetcher=vi.fn(async(url:string)=>{
    if(url.includes('sdo.gsfc.nasa.gov')) throw new Error('offline');
    return response(png,'image/png',fresh);
  }) as unknown as typeof fetch;
  expect(await createSdoLivePreviewService({fetcher,now:()=>now}).latest('aia193'))
    .toMatchObject({sourceId:'suvi-primary',stale:false,selectionReason:'preferred_unavailable'});
});

it('never calls an unknown-publication-time or invalid image fresh',async()=>{
  const noTime=createSdoLivePreviewService({now:()=>now,fetcher:vi.fn(async(url:string)=>
    new Response(url.includes('sdo.gsfc.nasa.gov')?jpeg:png,{headers:{'Content-Type':
      url.includes('sdo.gsfc.nasa.gov')?'image/jpeg':'image/png'}})) as unknown as typeof fetch});
  expect(await noTime.latest('aia193')).toMatchObject({sourceId:'sdo',stale:true,
    selectionReason:'no_fresh_compatible_source'});
  const invalid=createSdoLivePreviewService({now:()=>now,fetcher:vi.fn(async()=>
    new Response('not an image',{headers:{'Content-Type':'image/png'}})) as unknown as typeof fetch});
  await expect(invalid.latest('aia171')).rejects.toThrow('solar_preview_unavailable');
});

it('does not substitute SUVI for a stale or unavailable HMI continuum intensitygram',async()=>{
  const staleFetcher=vi.fn(async()=>response(jpeg,'image/jpeg',old)) as unknown as typeof fetch;
  const staleService=createSdoLivePreviewService({fetcher:staleFetcher,now:()=>now});
  expect(await staleService.latest('hmiContinuum')).toMatchObject({
    sourceId:'sdo',stale:true,selectionReason:'no_fresh_compatible_source',
    observationAt:null,quantitativeComparisonAllowed:false,
  });
  expect(staleFetcher).toHaveBeenCalledTimes(2);
  expect(staleFetcher).not.toHaveBeenCalledWith(
    expect.stringContaining('suvi'),expect.anything(),
  );

  const unavailableFetcher=vi.fn(async()=>{throw new Error('offline')}) as unknown as typeof fetch;
  const unavailableService=createSdoLivePreviewService({fetcher:unavailableFetcher,now:()=>now});
  await expect(unavailableService.latest('hmiContinuum')).rejects.toThrow('solar_preview_unavailable');
  expect(unavailableFetcher).toHaveBeenCalledTimes(2);
});

const hmiMetadata=(date:string,id:string|number='192879714',name='HMI Int')=>new Response(
  JSON.stringify({id,date,name,width:4096,height:4096,refPixelX:2048.5,refPixelY:2048.5,
    offsetX:0,offsetY:0,rotation:0,scale:0.59887}),
  {headers:{'Content-Type':'application/json'}},
);

it('uses a recent Helioviewer HMI intensitygram when the SDO latest file is stale',async()=>{
  const imageUrl='https://api.helioviewer.org/v2/downloadImage/?id=192879714&width=512&type=jpg';
  const fetcher=vi.fn(async(url:string)=>{
    if(url.includes('getClosestImage')) return hmiMetadata('2026-09-30 08:59:00');
    if(url===imageUrl) return response(jpeg,'image/jpeg',fresh);
    return response(jpeg,'image/jpeg',old);
  }) as unknown as typeof fetch;
  const service=createSdoLivePreviewService({fetcher,now:()=>now});
  const result=await service.latest('hmiContinuum');
  expect(result).toMatchObject({
    sourceId:'helioviewer-hmi',source:'Helioviewer / NASA SDO HMI',
    channel:'hmiContinuum',instrument:'HMI',productKind:'browse_image',
    observationAt:'2026-09-30T08:59:00.000Z',upstreamImageId:'192879714',
    sourceUrl:imageUrl,stale:false,selectionReason:'preferred_stale',
    scienceRunAllowed:false,quantitativeComparisonAllowed:false,
  });
  expect(fetcher).toHaveBeenCalledWith(
    'https://api.helioviewer.org/v2/getClosestImage/?date=2026-09-30T10%3A01%3A00Z&sourceId=18',
    expect.objectContaining({redirect:'error',cache:'no-store'}),
  );
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(service.image('hmiContinuum','helioviewer-hmi',result.sha256))
    .toEqual({bytes:Buffer.from(jpeg),mime:'image/jpeg'});
  expect(service.helioviewerGeometry('hmiContinuum','helioviewer-hmi',result.sha256))
    .toMatchObject({width:4096,height:4096,offsetX:0,offsetY:0,rotation:0});
  expect(service.helioviewerGeometry('hmiMag','helioviewer-hmi-mag',result.sha256)).toBeNull();
  expect(service.image('hmiMag','helioviewer-hmi',result.sha256)).toBeNull();
});

it('reads the exact Helioviewer source for registered overlays without changing default selection',async()=>{
  const fetcher=vi.fn(async(url:string)=>{
    if(url.includes('getClosestImage')) return hmiMetadata('2026-09-30 09:00:00');
    if(url.includes('downloadImage')) return response(jpeg,'image/jpeg',fresh);
    return response(jpeg,'image/jpeg',fresh);
  }) as unknown as typeof fetch;
  const service=createSdoLivePreviewService({fetcher,now:()=>now});
  const exact=await service.fromSource('hmiContinuum','helioviewer-hmi');
  expect(exact).toMatchObject({sourceId:'helioviewer-hmi',selectionReason:'explicit_source',
    upstreamImageId:'192879714',observationAt:'2026-09-30T09:00:00.000Z'});
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await service.latest('hmiContinuum')).toMatchObject({sourceId:'sdo',
    selectionReason:'preferred_fresh'});
  await expect(service.fromSource('hmiMag','helioviewer-hmi')).rejects
    .toThrow('solar_preview_source_unavailable');
});

it('uses a recent Helioviewer HMI intensitygram when the SDO latest file is unavailable',async()=>{
  const fetcher=vi.fn(async(url:string)=>{
    if(url.includes('getClosestImage')) return hmiMetadata('2026-09-30 09:00:00');
    if(url.includes('downloadImage')) return response(jpeg,'image/jpeg',fresh);
    throw new Error('SDO unavailable');
  }) as unknown as typeof fetch;
  expect(await createSdoLivePreviewService({fetcher,now:()=>now}).latest('hmiContinuum'))
    .toMatchObject({sourceId:'helioviewer-hmi',stale:false,
      selectionReason:'preferred_unavailable',observationAt:'2026-09-30T09:00:00.000Z'});
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('uses only the Helioviewer HMI magnetogram source when the SDO magnetogram is stale',async()=>{
  const imageUrl='https://api.helioviewer.org/v2/downloadImage/?id=192879715&width=512&type=jpg';
  const fetcher=vi.fn(async(url:string)=>{
    if(url.includes('getClosestImage')) return hmiMetadata('2026-09-30 09:00:00','192879715','HMI Mag');
    if(url===imageUrl) return response(jpeg,'image/jpeg',fresh);
    return response(jpeg,'image/jpeg',old);
  }) as unknown as typeof fetch;
  const service=createSdoLivePreviewService({fetcher,now:()=>now});
  const result=await service.latest('hmiMag');
  expect(result).toMatchObject({
    channel:'hmiMag',sourceId:'helioviewer-hmi-mag',source:'Helioviewer / NASA SDO HMI',
    label:'HMI magnetogram (Helioviewer)',instrument:'HMI',productKind:'browse_image',
    observationAt:'2026-09-30T09:00:00.000Z',upstreamImageId:'192879715',
    sourceUrl:imageUrl,stale:false,selectionReason:'preferred_stale',
    scienceRunAllowed:false,quantitativeComparisonAllowed:false,
  });
  expect(fetcher).toHaveBeenCalledWith(
    'https://api.helioviewer.org/v2/getClosestImage/?date=2026-09-30T10%3A01%3A00Z&sourceId=19',
    expect.objectContaining({redirect:'error',cache:'no-store'}),
  );
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(service.image('hmiMag','helioviewer-hmi-mag',result.sha256))
    .toEqual({bytes:Buffer.from(jpeg),mime:'image/jpeg'});
  expect(service.image('hmiContinuum','helioviewer-hmi-mag',result.sha256)).toBeNull();
  expect(service.image('hmiMag','helioviewer-hmi',result.sha256)).toBeNull();
});

it('uses a recent Helioviewer HMI magnetogram when the SDO magnetogram is unavailable',async()=>{
  const fetcher=vi.fn(async(url:string)=>{
    if(url.includes('getClosestImage')) return hmiMetadata('2026-09-30 09:00:00','192879715','HMI Mag');
    if(url.includes('downloadImage')) return response(jpeg,'image/jpeg',fresh);
    throw new Error('SDO unavailable');
  }) as unknown as typeof fetch;
  expect(await createSdoLivePreviewService({fetcher,now:()=>now}).latest('hmiMag'))
    .toMatchObject({sourceId:'helioviewer-hmi-mag',stale:false,
      selectionReason:'preferred_unavailable',observationAt:'2026-09-30T09:00:00.000Z'});
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('does not call a Helioviewer magnetogram recent from a fresh download header alone',async()=>{
  const fetcher=vi.fn(async(url:string)=>{
    if(url.includes('getClosestImage')) return hmiMetadata('2026-09-29 23:00:00','192879715','HMI Mag');
    if(url.includes('downloadImage')) return response(jpeg,'image/jpeg',fresh);
    return response(jpeg,'image/jpeg',old);
  }) as unknown as typeof fetch;
  expect(await createSdoLivePreviewService({fetcher,now:()=>now}).latest('hmiMag'))
    .toMatchObject({sourceId:'helioviewer-hmi-mag',stale:true,
      selectionReason:'no_fresh_compatible_source',observationAt:'2026-09-29T23:00:00.000Z'});
});

it('rejects an intensitygram identity from the Helioviewer magnetogram lookup',async()=>{
  const fetcher=vi.fn(async(url:string)=>{
    if(url.includes('getClosestImage')) return hmiMetadata('2026-09-30 09:00:00');
    if(url.includes('downloadImage')) throw new Error('unexpected download');
    return response(jpeg,'image/jpeg',old);
  }) as unknown as typeof fetch;
  expect(await createSdoLivePreviewService({fetcher,now:()=>now}).latest('hmiMag'))
    .toMatchObject({sourceId:'sdo',stale:true,observationAt:null});
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('uses only an actual Helioviewer observation time for the six-hour freshness test',async()=>{
  const fetcher=vi.fn(async(url:string)=>{
    if(url.includes('getClosestImage')) return hmiMetadata('2026-09-29 23:00:00');
    if(url.includes('downloadImage')) return response(jpeg,'image/jpeg',fresh);
    return response(jpeg,'image/jpeg',old);
  }) as unknown as typeof fetch;
  const result=await createSdoLivePreviewService({fetcher,now:()=>now}).latest('hmiContinuum');
  expect(result).toMatchObject({sourceId:'helioviewer-hmi',stale:true,
    selectionReason:'no_fresh_compatible_source',observationAt:'2026-09-29T23:00:00.000Z'});
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it.each([
  ['wrong instrument',hmiMetadata('2026-09-30 09:00:00','192879714','AIA 193')],
  ['wrong HMI product',hmiMetadata('2026-09-30 09:00:00','192879714','HMI Mag')],
  ['invalid ID',hmiMetadata('2026-09-30 09:00:00','1&sourceId=19')],
  ['invalid calendar date',hmiMetadata('2026-02-30 09:00:00')],
  ['future observation',hmiMetadata('2026-10-01 09:00:00')],
])('rejects %s in Helioviewer metadata before any image download',async(_case,metadata)=>{
  const fetcher=vi.fn(async(url:string)=>{
    if(url.includes('getClosestImage')) return metadata.clone();
    if(url.includes('downloadImage')) throw new Error('unexpected download');
    return response(jpeg,'image/jpeg',old);
  }) as unknown as typeof fetch;
  const result=await createSdoLivePreviewService({fetcher,now:()=>now}).latest('hmiContinuum');
  expect(result).toMatchObject({sourceId:'sdo',stale:true,
    selectionReason:'no_fresh_compatible_source',observationAt:null});
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('rejects a non-JPEG Helioviewer download instead of presenting an unverified image',async()=>{
  const fetcher=vi.fn(async(url:string)=>{
    if(url.includes('getClosestImage')) return hmiMetadata('2026-09-30 09:00:00');
    if(url.includes('downloadImage')) return response(png,'image/png',fresh);
    return response(jpeg,'image/jpeg',old);
  }) as unknown as typeof fetch;
  const result=await createSdoLivePreviewService({fetcher,now:()=>now}).latest('hmiContinuum');
  expect(result).toMatchObject({sourceId:'sdo',stale:true,
    selectionReason:'no_fresh_compatible_source'});
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('bounds Helioviewer metadata before accepting an image identifier',async()=>{
  const fetcher=vi.fn(async(url:string)=>{
    if(url.includes('getClosestImage')) return new Response('x'.repeat(65*1024),{
      headers:{'Content-Type':'application/json'},
    });
    if(url.includes('downloadImage')) throw new Error('unexpected download');
    return response(jpeg,'image/jpeg',old);
  }) as unknown as typeof fetch;
  expect(await createSdoLivePreviewService({fetcher,now:()=>now}).latest('hmiContinuum'))
    .toMatchObject({sourceId:'sdo',stale:true});
  expect(fetcher).toHaveBeenCalledTimes(2);
});
