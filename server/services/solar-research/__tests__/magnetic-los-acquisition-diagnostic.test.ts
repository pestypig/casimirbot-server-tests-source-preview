import {mkdtemp,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {prepareOwnerMagneticLosDiagnostic} from '../magnetic-los-acquisition-diagnostic';

const mocks=vi.hoisted(()=>({read:vi.fn(),map:vi.fn()}));
vi.mock('../magnetic-archive-acquisition',()=>({readSolarMagneticAcquisition:mocks.read}));
vi.mock('../gong-fits-display-map',()=>({prepareGongDisplayMap:mocks.map}));

const gongId=`magnetic-acquisition:${'a'.repeat(64)}`,hmiId=`magnetic-acquisition:${'b'.repeat(64)}`;
const gongSha='c'.repeat(64),hmiSha='d'.repeat(64);
const gongUrl='https://magmap.nso.edu/oQR/zqs/202609/mrzqs260928/mrzqs260928t1704c2316_265.fits.gz';
const hmiUrl='https://suntoday.lmsal.com/sdomedia/SunInTime/2026/09/28/fblos.fits';
const owner={tenantId:'test',accountProfileId:'owner-a'};
const map={schemaVersion:'solar-global-radial-map/1',source:{provider:'NSO/GONG',productId:'mrzqs260928t1704c2316_265',
  sourceUrl:gongUrl,sha256:gongSha,kind:'synoptic_derived',inputStartUtc:null,
  inputEndUtc:'2026-09-28T17:04:00Z',retrievedAtUtc:'2026-09-28T19:00:00Z'},
  coordinateFrame:'Carrington',grid:'longitude_by_sine_latitude_cell_centers',units:'G',
  longitudeCells:12,sineLatitudeCells:6,radialGauss:Array(72).fill(25),
  observedMaskStatus:'unavailable',observedCellMask:Array(72).fill(false),
  sourceIdentityAuthenticated:false,scientificAdmission:false};
const metric=(count:number)=>({sampleCount:count,meanResidualGauss:1,
  medianAbsoluteResidualGauss:2,rootMeanSquareResidualGauss:3});
const payload={schemaVersion:'solar-magnetic-los-diagnostic/1',mapSourceProductId:map.source.productId,
  mapSourceSha256:gongSha,mapLatestContributorUtc:map.source.inputEndUtc,mapEarliestContributorUtc:null,
  hmi:{sourceUrl:hmiUrl,sha256:hmiSha,drmsId:'lm_jps.m45s_nrt:123:magnetogram',
    observedAtUtc:'2026-09-28T18:00:00Z',qualityFlag:1024,instrument:'HMI',
    fieldComponent:'line_of_sight',units:'G',coordinateFrame:'helioprojective_WCS',
    observerCarringtonLongitudeDeg:12,observerCarringtonLatitudeDeg:4},
  projection:{method:'radial_map_times_exact_radial_line_of_sight_cosine_nearest_cell/1',
    mapCoordinateFrame:'Carrington',sampleStridePixels:32,minimumMu:0.5,activeThresholdGauss:20,
    fullDiskPixelCount:4096*4096,sampledPixelCount:16_384,registeredDiskSampleCount:100,
    distinctMapCells:50},allRegistered:metric(100),activeField:metric(10),
  longitudeShiftControls:[{longitudeShiftDeg:90,activeFieldOnSameSamples:metric(10)},
    {longitudeShiftDeg:180,activeFieldOnSameSamples:metric(10)}],
  bothAboveThresholdCount:1,bothAboveThresholdSignAgreement:1,
  displayPoints:[{longitudeDeg:12,latitudeDeg:4,measuredLosGauss:24,projectedMapLosGauss:20,mu:0.8}],
  sourceIdentityAuthenticated:false,scientificAdmission:false,quantitativeValidationAllowed:false};
let root:string;
beforeEach(async()=>{
  root=await mkdtemp(path.join(os.tmpdir(),'solar-los-service-test-'));
  mocks.read.mockReset();mocks.map.mockReset();
  mocks.read.mockImplementation(async(_owner:unknown,id:string)=>id===gongId
    ?{receipt:{provider:'nso_gong',sha256:gongSha},bytes:Buffer.from('gong')}
    :id===hmiId?{receipt:{provider:'lmsal_sdo',sha256:hmiSha,sourceUrl:hmiUrl,
      qualityStatus:'header_quality_nonzero',hmiHeader:{observedAtUtc:payload.hmi.observedAtUtc,
        qualityFlag:1024,drmsId:payload.hmi.drmsId}},bytes:Buffer.from('hmi')}:null);
  mocks.map.mockReturnValue(map);
});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});

it('binds both exact owner receipts to a content-checked non-admitted diagnostic and removes scratch files',async()=>{
  const runner=vi.fn(async(_script:string,options:{args:string[]})=>{
    expect(options.args[3]).toBe(hmiUrl);
    return payload;
  });
  const result=await prepareOwnerMagneticLosDiagnostic(owner,gongId,hmiId,{runner,tempRoot:root});
  expect(result).toMatchObject({gongAcquisitionId:gongId,hmiAcquisitionId:hmiId,
    scientificAdmission:false,quantitativeValidationAllowed:false,
    diagnostic:{hmi:{qualityFlag:1024},sourceMapContentId:expect.stringMatching(/^solar-radial:/),
      diagnosticId:expect.stringMatching(/^solar-los:/)}});
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(await readdir(root)).toEqual([]);
});

it('rejects a worker result naming other HMI bytes and cleans the temporary directory',async()=>{
  await expect(prepareOwnerMagneticLosDiagnostic(owner,gongId,hmiId,{tempRoot:root,
    runner:async()=>({...payload,hmi:{...payload.hmi,sha256:'e'.repeat(64)}})}))
    .rejects.toThrow('SOLAR_LOS_DIAGNOSTIC_SOURCE_MISMATCH');
  expect(await readdir(root)).toEqual([]);
});

it('rejects reversed source kinds before invoking a worker',async()=>{
  mocks.read.mockImplementation(async(_owner:unknown,id:string)=>id===gongId
    ?{receipt:{provider:'lmsal_sdo'},bytes:Buffer.from('wrong')}:null);
  const runner=vi.fn();
  await expect(prepareOwnerMagneticLosDiagnostic(owner,gongId,hmiId,{tempRoot:root,runner}))
    .rejects.toThrow('SOLAR_LOS_ACQUISITION_NOT_FOUND');
  expect(runner).not.toHaveBeenCalled();
});
