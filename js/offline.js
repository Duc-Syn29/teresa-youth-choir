(function () {
  'use strict';
  const url=new URL(location.href);
  if(!('serviceWorker' in navigator) || url.searchParams.has('preview') || /\/admin(?:\.html)?$/.test(url.pathname))return;
  window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{});},{once:true});
})();
