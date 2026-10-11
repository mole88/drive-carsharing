const assert=require('node:assert/strict');
const {chromium}=require('playwright');
require('node:fs').mkdirSync('tmp',{recursive:true});
const target=process.argv[2]||'http://127.0.0.1:8000';
(async()=>{const browser=await chromium.launch({headless:true,channel:'chrome'});try{
 for(const [name,width,height,mobile] of [['desktop',1440,1000,false],['phone',390,844,true],['small-phone',320,568,true],['landscape',844,390,true]]){
  const page=await browser.newPage({viewport:{width,height},isMobile:mobile,hasTouch:mobile});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(target+'/drive?car=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.DriveGame&&!document.querySelector('#drive-start').disabled);
  await page.locator('#drive-stage').screenshot({path:`tmp/ui-after-${name}-intro.png`});
  await page.locator('#drive-start').click();
  await page.waitForFunction(()=>DriveGame.state.world.time>2);
  await page.waitForFunction(()=>{const c=document.querySelector('#drive-caster');return c.height>0&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>100)});
  const measurements=await page.evaluate(()=>{
    const g=DriveGame;g.togglePause(true);document.querySelector('#drive-pause').hidden=true;
    const box=id=>{const r=document.querySelector(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}};
    const ids=['.hud-row-2','.hud-actions','.hud-nitro','.hud-economy','#hud-retire','#hud-heat','#hud-hearts'];
    g.state.world.player.combo=1;g.hud(0);
    const before=ids.map(box);
    g.state.world.player.combo=2;g.state.world.player.chain=2;g.hud(0);
    const after=ids.map(box);
    const c=document.querySelector('#drive-caster'),ctx=c.getContext('2d'),data=ctx.getImageData(0,0,c.width,c.height).data;
    let alphaBottom=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(data[(y*c.width+x)*4+3]>100)alphaBottom=Math.max(alphaBottom,y);
    return {before,after,stage:box('#drive-stage'),caster:box('#drive-caster'),alphaBottom:alphaBottom/c.height,nitro:box('.nitro-track'),combo:box('#hud-combo'),controls:['#touch-bribe','#touch-nitro'].map(box),documentWidth:document.documentElement.scrollWidth,viewport:innerWidth,selectionStyle:getComputedStyle(document.querySelector('#touch-nitro')).userSelect,callout:getComputedStyle(document.querySelector('#touch-nitro')).webkitTouchCallout,touch:getComputedStyle(document.querySelector('#touch-nitro')).touchAction,coach:!!document.querySelector('#drive-coach')};
  });
  assert.deepEqual(measurements.before,measurements.after,`${name}: combo shifted HUD`);
  assert.equal(measurements.coach,false);
  assert.ok(Math.abs(measurements.nitro.y-measurements.caster.bottom-2)<1,`${name}: caster gap`);
  assert.ok(measurements.alphaBottom>.97,`${name}: transparent bottom remained`);
  assert.ok(measurements.documentWidth<=measurements.viewport,`${name}: page overflows`);
  assert.ok(measurements.combo.right<=measurements.stage.right,`${name}: combo overflows`);
  if(mobile){
    for(const b of measurements.controls){assert.equal(b.width,76);assert.equal(b.height,44);assert.ok(b.bottom<=measurements.stage.bottom);}
    assert.equal(measurements.selectionStyle,'none');assert.equal(measurements.touch,'none');
    const x=measurements.controls[1].x+38,y=measurements.controls[1].y+22;
    await page.mouse.move(x,y);await page.mouse.down();
    assert.equal(await page.evaluate(()=>DriveGame.state.touchNitro),true);
    await page.mouse.move(x-90,y-40);await page.mouse.up();
    assert.equal(await page.evaluate(()=>DriveGame.state.touchNitro),false);
    const prevented=await page.evaluate(()=>{const el=document.querySelector('#touch-bribe');const result=['contextmenu','selectstart','dragstart'].map(t=>!el.dispatchEvent(new Event(t,{bubbles:true,cancelable:true})));return {result,selection:getSelection().toString()}});
    assert.ok(prevented.result.every(Boolean));assert.equal(prevented.selection,'');
    if(name==='landscape')assert.ok(measurements.stage.height<height,'landscape does not fit');
  }
  await page.locator('#drive-stage').screenshot({path:`tmp/ui-after-${name}.png`});
  await page.evaluate(()=>{const g=DriveGame,p=g.state.world.player;p.encounter={cost:900,timer:1};p.nitroTime=2;p.powers.shield=5;p.powers.magnet=5;p.powers.radar=5;g.state.world.level=24;p.heat=6;p.combo=6;p.chain=122;g.state.recordScore=10;p.score=20000;g.hud(0)});
  await page.locator('#drive-stage').screenshot({path:`tmp/ui-after-${name}-encounter.png`});
  const prompt=await page.locator('#bribe-prompt').boundingBox();assert.ok(prompt.height<100,'encounter blocks view');
  const collisions=await page.evaluate(()=>{const p=document.querySelector('#bribe-prompt').getBoundingClientRect(),b=document.querySelector('#touch-bribe').getBoundingClientRect();const overlapping=b.width>0&&p.bottom>b.top&&p.right>b.left;const combo=document.querySelector('#hud-combo');return {overlapping,comboOverflow:combo.scrollWidth>combo.clientWidth,coach:!!document.querySelector('#drive-coach')}});
  assert.equal(collisions.overlapping,false,`${name}: late encounter overlaps controls`);assert.equal(collisions.comboOverflow,false);
  const footer=await page.evaluate(()=>{const powers=document.querySelector('#hud-powers').getBoundingClientRect(),nitro=document.querySelector('.nitro-track').getBoundingClientRect(),level=document.querySelector('#hud-level');return {powerHeight:powers.height,powerBottom:powers.bottom,nitroTop:nitro.top,levelClipped:getComputedStyle(level).overflowY==='hidden'&&level.scrollHeight>level.clientHeight+1}});
  assert.equal(footer.levelClipped,false,`${name}: pressure value clipped`);
  assert.ok(footer.powerHeight<=50,`${name}: bonuses cover the road`);
  assert.ok(footer.powerBottom<footer.nitroTop,`${name}: bonuses overlap nitro`);
  await page.evaluate(()=>{for(const time of [1.5,9,22,40,66,96,134,200]){DriveGame.state.world.time=time;DriveGame.hud(0)}});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({name,measurements,errors}));
  await page.close();
 }
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
