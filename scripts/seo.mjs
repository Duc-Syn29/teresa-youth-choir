const ORIGIN='https://cadoangioitreteresa.org';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function metadata({title,description='',file='',image='',article=false,body=''}) {
 const url=new URL(file.replace(/\.html$/,''),ORIGIN+'/').href;
 const photo=new URL(image||'images/optimized/hero-1280.webp',ORIGIN+'/').href;
 const text=description.replace(/\s+/g,' ').trim().slice(0,300);
 const schema={'@context':'https://schema.org','@type':article?'Article':'CollectionPage',name:title,...(article?{headline:title,articleBody:body,author:{'@type':'Organization',name:'Ca đoàn Giới trẻ Têrêsa'}}:{}),description:text,url,image:photo,inLanguage:'vi',publisher:{'@type':'Organization',name:'Ca đoàn Giới trẻ Têrêsa',url:ORIGIN}};
 return `<meta name="description" content="${escape(text)}" /><link rel="canonical" href="${escape(url)}" /><meta property="og:locale" content="vi_VN" /><meta property="og:site_name" content="Teresa Youth Choir" /><meta property="og:type" content="${article?'article':'website'}" /><meta property="og:title" content="${escape(title)}" /><meta property="og:description" content="${escape(text)}" /><meta property="og:url" content="${escape(url)}" /><meta property="og:image" content="${escape(photo)}" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${escape(title)}" /><meta name="twitter:description" content="${escape(text)}" /><meta name="twitter:image" content="${escape(photo)}" /><script type="application/ld+json">${JSON.stringify(schema).replace(/</g,'\\u003c')}</script>`;
}
export function withMetadata(html, options) {
 return html.replace(/<meta\s+name="description"[\s\S]*?\/>/,'').replace(/<link rel="canonical"[^>]*>/g,'').replace(/<meta (?:property="og:[^"]+"|name="twitter:[^"]+")[^>]*>/g,'').replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g,'').replace('</head>',metadata(options)+'</head>');
}
