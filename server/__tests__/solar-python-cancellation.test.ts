import path from 'node:path';
import { expect, it } from 'vitest';
import { runPythonScript, standaloneRuntimeCommand } from '../utils/run-python';

it('uses extended Windows executable paths without changing non-Windows commands',()=>{
  const executable=path.win32.join('C:/build',...Array(20).fill('nested-folder'),'solar-exporter.exe');
  expect(standaloneRuntimeCommand(executable,'win32')).toBe(path.win32.toNamespacedPath(executable));
  expect(standaloneRuntimeCommand('/opt/solar/exporter','linux')).toBe('/opt/solar/exporter');
});

it('invokes a standalone JSON executable without a Python script argument',async()=>{
  const result=await runPythonScript('',{standaloneExecutable:process.execPath,
    args:['-e','console.log(JSON.stringify({standalone:true}))'],timeoutMs:5000});
  expect(result).toEqual({standalone:true});
  await expect(runPythonScript('',{standaloneExecutable:'relative.exe'})).rejects.toThrow('absolute');
});

it('terminates a real local Python process when its caller aborts',async()=>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),200);
  const start=Date.now();
  try {
    await expect(runPythonScript(path.resolve('tools/__tests__/fixtures/solar-cancel-fixture.py'),
      {timeoutMs:15000,signal:controller.signal})).rejects.toThrow(/abort/i);
    expect(Date.now()-start).toBeLessThan(5000);
  } finally {clearTimeout(timer);}
},10000);

it('keeps a longer runtime-check budget caller-cancellable',async()=>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),200);
  const started=Date.now();
  try {
    await expect(runPythonScript('',{standaloneExecutable:process.execPath,
      args:['-e','setTimeout(()=>console.log(JSON.stringify({available:true})),60000)'],
      timeoutMs:60000,signal:controller.signal})).rejects.toThrow(/abort/i);
    expect(Date.now()-started).toBeLessThan(5000);
  } finally {clearTimeout(timer);}
},10000);
