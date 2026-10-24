// Injected at delivery time. Published game files remain unchanged.
export function playBridgeScript(deploymentId, portalOrigin) {
  const data = JSON.stringify({ deploymentId, portalOrigin }).replace(
    /</g,
    "\\u003c",
  );
  return `<script>(()=>{
    const {deploymentId,portalOrigin}=${data};
    if(window.parent===window)return;
    try{if(new URL(document.referrer).origin!==portalOrigin)return}catch{return}
    let sent=false;
    const report=event=>{
      if(sent||!event.isTrusted||document.visibilityState!=='visible')return;
      if(event.type==='keydown'&&(event.repeat||event.ctrlKey||event.metaKey||event.altKey||['Tab','Escape','Shift','Control','Alt','Meta','CapsLock'].includes(event.key)))return;
      if(event.type==='pointerdown'&&event.button!==0)return;
      sent=true;
      window.parent.postMessage({type:'beegame:play',version:1,deploymentId},portalOrigin);
      document.removeEventListener('pointerdown',report,true);
      document.removeEventListener('keydown',report,true);
    };
    document.addEventListener('pointerdown',report,true);
    document.addEventListener('keydown',report,true);
  })();</script>`;
}
