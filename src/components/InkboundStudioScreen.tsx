import React, { useMemo, useState } from 'react';
import { Download, Image, MessageSquareQuote, Share2, Sparkles, Star } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { getSessionDurationMinutes } from '../features/reading/sessionAnalytics';
import { getPreferredSavedQuote } from '../features/reading/bookQuotes';
import { exportRuntimeBinaryFile, shareRuntimeBinaryFile } from '../platform/runtimeExport';
import { fetchRuntimeMediaDataUrl } from '../platform/runtimeMedia';

interface InkboundStudioScreenProps { books: UserBookRecord[]; sessions: ReadingSession[]; }
type ShareFormat = 'story' | 'portrait' | 'square' | 'pinterest';
type ShareTheme = 'quiet-library' | 'cozy-autumn' | 'dark-academia' | 'celestial';
type CardTemplate = 'reading-card' | 'quote-card' | 'review-card' | 'reading-update';
type CardLayout = 'editorial' | 'cover-focus' | 'minimal';
interface SharePreferences { format: ShareFormat; theme: ShareTheme; template: CardTemplate; layout: CardLayout; showRating: boolean; showPages: boolean; showReadingTime: boolean; selectedBookId: string; selectedQuoteId?: string; }
const STORAGE_KEY = 'inkbound_share_preferences';
const STUDIO_BACKGROUND = '/assets/studio/cozy-monthly-background.png';
const formats: Record<ShareFormat, { label: string; width: number; height: number }> = { story:{label:'Story 9:16',width:1080,height:1920},portrait:{label:'Feed 4:5',width:1080,height:1350},square:{label:'Square 1:1',width:1080,height:1080},pinterest:{label:'Pinterest 2:3',width:1000,height:1500} };
const themes: Record<ShareTheme,{label:string;background:string;accent:string;text:string}> = {'quiet-library':{label:'Quiet Library',background:'#171217',accent:'#9b7287',text:'#f2e9df'},'cozy-autumn':{label:'Cozy Autumn',background:'#3a241d',accent:'#c58b61',text:'#fff1df'},'dark-academia':{label:'Dark Academia',background:'#201b19',accent:'#9c8067',text:'#efe3d4'},celestial:{label:'Celestial',background:'#17192f',accent:'#a8a3d4',text:'#f3f1ff'}};
const templates: Record<CardTemplate,{label:string;description:string}> = {'reading-card':{label:'Book Card',description:'A polished finished or currently-reading card.'},'quote-card':{label:'Favorite Quote',description:'Turn a saved quote into something worth sharing.'},'review-card':{label:'Mini Review',description:'Pair your rating with a short review excerpt.'},'reading-update':{label:'Reading Update',description:'Share progress, pages and time without a screenshot.'}};
const layouts: Record<CardLayout,{label:string;description:string}> = {editorial:{label:'Editorial',description:'Cover + typography with a magazine-like composition.'},'cover-focus':{label:'Cover Focus',description:'Let the book art lead the card.'},minimal:{label:'Minimal',description:'A quiet text-first Inkbound card.'}};
const escapeXml=(v:string)=>v.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const truncate=(v:string,l:number)=>v.length>l?`${v.slice(0,l-1).trim()}…`:v;
const fileToDataUrl=(blob:Blob)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result??''));reader.onerror=()=>reject(reader.error??new Error('Could not read image.'));reader.readAsDataURL(blob);});const wrapSvgText=(value:string,fontSize:number,maxWidth:number,maxLines:number)=>{const words=value.trim().split(/\s+/).filter(Boolean);if(!words.length)return[''];const maxChars=Math.max(8,Math.floor(maxWidth/(fontSize*.54)));const lines:string[]=[];let line='';for(const word of words){const candidate=line?`${line} ${word}`:word;if(candidate.length<=maxChars||!line)line=candidate;else{lines.push(line);line=word;}}if(line)lines.push(line);if(lines.length<=maxLines)return lines;const visible=lines.slice(0,maxLines);visible[maxLines-1]=`${visible[maxLines-1].replace(/[.…]+$/,'')}…`;return visible;};
const svgTextLines=(lines:string[],x:number,y:number,fontSize:number,lineHeight:number,attrs:string)=>lines.map((line,index)=>`<text x="${x}" y="${y+index*lineHeight}" ${attrs} font-size="${fontSize}">${escapeXml(line)}</text>`).join('');
const wrapSvgTextFull=(value:string,fontSize:number,maxWidth:number)=>{const words=value.trim().split(/\s+/).filter(Boolean);if(!words.length)return[''];const maxChars=Math.max(8,Math.floor(maxWidth/(fontSize*.54)));const lines:string[]=[];let line='';for(const word of words){const candidate=line?`${line} ${word}`:word;if(candidate.length<=maxChars||!line)line=candidate;else{lines.push(line);line=word;}}if(line)lines.push(line);return lines;};
const fitSvgText=(value:string,maxWidth:number,maxHeight:number,maxFontSize:number,minFontSize:number)=>{let fontSize=Math.max(minFontSize,maxFontSize);let lines=wrapSvgTextFull(value,fontSize,maxWidth);let lineHeight=fontSize*1.12;while(fontSize>minFontSize&&lines.length*lineHeight>maxHeight){fontSize=Math.max(minFontSize,fontSize-2);lines=wrapSvgTextFull(value,fontSize,maxWidth);lineHeight=fontSize*1.1;}return{lines,fontSize,lineHeight};};
const studioTitleSortKey=(value:string)=>value.trim().replace(/^(?:a|an|the)\s+/i,'').trim().toLocaleLowerCase();
const quotePresentationScale=(length:number)=>{
 if(length>150)return .032;
 if(length>110)return .036;
 if(length>75)return .040;
 return .047;
};
const titlePresentationScale=(template:CardTemplate,length:number)=>{
 if(template==='quote-card')return quotePresentationScale(length);
 if(length>70)return .028;
 if(length>50)return .031;
 if(length>34)return .035;
 return .041;
};
const previewTitleRem=(template:CardTemplate,layout:CardLayout,format:ShareFormat,length:number)=>{
 let size=template==='quote-card'?2.05:template==='review-card'?1.85:2.15;
 if(layout==='editorial')size*=.82;
 else if(layout==='cover-focus')size*=.9;
 if(format==='square')size*=.82;
 else if(format==='portrait')size*=.9;
 if(template==='quote-card'){
   if(length>150)size*=.62;
   else if(length>110)size*=.72;
   else if(length>75)size*=.82;
 }else{
   if(length>70)size*=.68;
   else if(length>50)size*=.76;
   else if(length>34)size*=.86;
 }
 return Math.max(.95,Math.min(size,2.35));
};
const normalizeStudioSearchText=(value:string)=>value
 .normalize('NFKD')
 .replace(/[\u0300-\u036f]/g,'')
 .toLocaleLowerCase()
 .replace(/[^\p{L}\p{N}]+/gu,' ')
 .trim()
 .replace(/\s+/g,' ');

export const InkboundStudioScreen:React.FC<InkboundStudioScreenProps>=({books,sessions})=>{
 const shareableBooks=useMemo(()=>books
   .filter(b=>b.status==='finished'||b.status==='currently-reading')
   .slice()
   .sort((a,b)=>{
     const titleCompare=studioTitleSortKey(a.work.title).localeCompare(studioTitleSortKey(b.work.title),undefined,{sensitivity:'base',numeric:true});
     return titleCompare||a.work.author.localeCompare(b.work.author,undefined,{sensitivity:'base'});
   }),[books]); const firstBookId=shareableBooks[0]?.id??books[0]?.id??'';
 const [preferences,setPreferences]=usePersistentState<SharePreferences>(STORAGE_KEY,{format:'portrait',theme:'quiet-library',template:'reading-card',layout:'editorial',showRating:true,showPages:true,showReadingTime:true,selectedBookId:firstBookId,selectedQuoteId:''}); const [message,setMessage]=useState('');
 const [bookSearch,setBookSearch]=useState('');
 const filteredShareableBooks=useMemo(()=>{
   const query=normalizeStudioSearchText(bookSearch);
   if(!query)return shareableBooks;
   return shareableBooks.filter(book=>[
     book.work.title,
     book.work.author,
     book.work.seriesName??'',
   ].some(value=>normalizeStudioSearchText(value).includes(query)));
 },[bookSearch,shareableBooks]);
 const selectedBook=books.find(b=>b.id===preferences.selectedBookId)??shareableBooks[0]??books[0]; const selectedQuote=getPreferredSavedQuote(selectedBook,preferences.selectedQuoteId); const bookSessions=sessions.filter(s=>s.bookId===selectedBook?.id&&getSessionDurationMinutes(s)>0); const readingMinutes=bookSessions.reduce((sum,s)=>sum+getSessionDurationMinutes(s),0); const edition=selectedBook?.editions.find(i=>i.id===selectedBook.activeEditionId)??selectedBook?.editions[0]; const coverUrl=edition?.coverUrl?.trim()??''; const format=formats[preferences.format]??formats.portrait; const theme=themes[preferences.theme]??themes['quiet-library']; const template=templates[preferences.template]??templates['reading-card']; const layout=layouts[preferences.layout]??layouts.editorial; const favoriteQuote=selectedQuote?.quote?.trim()??''; const review=selectedBook?.review?.trim()??''; const progress=Math.max(0,Math.min(100,Math.round(selectedBook?.progressPercentage??0))); const lengthText=edition?.format==='audiobook'?(edition.audiobookDurationMins?`${Math.floor(edition.audiobookDurationMins/60)}h ${edition.audiobookDurationMins%60}m audio`:'Audiobook'):(edition?.pageCount?`${edition.pageCount} pages`:'Book details'); const timeText=`${Math.floor(readingMinutes/60)}h ${readingMinutes%60}m reading`; const ratingText=selectedBook?.rating?`${selectedBook.rating} / 5`:'Not rated yet';
 const cardCopy=useMemo(()=>{if(!selectedBook)return{kicker:'',title:'',body:'',footer:''}; switch(preferences.template){case'quote-card':return{kicker:'A LINE I KEPT',title:favoriteQuote?`“${favoriteQuote}”`:'Save a favorite quote to make this card yours.',body:selectedBook.work.title,footer:selectedBook.work.author};case'review-card':return{kicker:selectedBook.rating?`${ratingText} · MY REVIEW`:'MY REVIEW',title:selectedBook.work.title,body:review?truncate(review,180):'Write a review in Inkbound and your words will appear here.',footer:selectedBook.work.author};case'reading-update':return{kicker:'CURRENTLY READING',title:selectedBook.work.title,body:`${progress}% complete${preferences.showReadingTime?` · ${timeText}`:''}`,footer:selectedBook.work.author};default:return{kicker:selectedBook.status==='finished'?'FINISHED READING':'CURRENTLY READING',title:selectedBook.work.title,body:selectedBook.work.author,footer:[preferences.showRating&&selectedBook.rating?ratingText:'',preferences.showPages?lengthText:'',preferences.showReadingTime?timeText:''].filter(Boolean).join(' · ')}}},[favoriteQuote,lengthText,preferences.showPages,preferences.showRating,preferences.showReadingTime,preferences.template,progress,ratingText,review,selectedBook,timeText]);
 const previewStyle=useMemo(()=>({aspectRatio:`${format.width} / ${format.height}`,backgroundImage:`linear-gradient(180deg, ${theme.background}33, ${theme.background}aa), url(${STUDIO_BACKGROUND})`,backgroundSize:'cover',backgroundPosition:'center',color:theme.text}),[format,theme]);
 const fetchData=(url:string)=>fetchRuntimeMediaDataUrl(url);

 const previewRef=React.useRef<HTMLDivElement>(null);
 // Export the approved HTML preview itself; never reconstruct a competing card layout.
 const createPng=async()=>{
   if(!selectedBook)throw new Error('Choose a book before exporting.');
   const source=previewRef.current;
   if(!source)throw new Error('Studio preview is not ready.');
   await document.fonts.ready;
   const rect=source.getBoundingClientRect();
   if(!rect.width||!rect.height)throw new Error('Studio preview has no visible dimensions.');
   const clone=source.cloneNode(true) as HTMLElement;
   const originalNodes=[source,...Array.from(source.querySelectorAll('*'))];
   const clonedNodes=[clone,...Array.from(clone.querySelectorAll('*'))];
   const images=new Map<string,string>();
   const embed=async(url:string)=>{
     if(url.startsWith('data:'))return url;
     if(!images.has(url)){
       const data=await fetchRuntimeMediaDataUrl(url);
       if(!data)throw new Error('Could not load a Studio image for export.');
       images.set(url,data);
     }
     return images.get(url)!;
   };
   // Inline computed styles, so Tailwind and theme rules survive SVG serialization.
   for(let i=0;i<originalNodes.length;i++){
     const original=originalNodes[i],target=clonedNodes[i] as HTMLElement|SVGElement;
     const computed=getComputedStyle(original);
     let css='';
     for(let j=0;j<computed.length;j++){
       const property=computed.item(j);
       css+=property+':'+computed.getPropertyValue(property)+';';
     }
     target.setAttribute('style',css);
     if(original instanceof HTMLImageElement && target instanceof HTMLImageElement){
       target.src=await embed(original.currentSrc||original.src);
     }
     const bg=computed.backgroundImage;
     if(bg&&bg!=='none'&&bg.includes('url(')){
       let updated=bg;
       const urls=Array.from(bg.matchAll(/url\(["']?([^"')]+)["']?\)/g));
       for(const match of urls){
         updated=updated.replace(match[0], 'url("'+await embed(match[1])+'")');
       }
       (target as HTMLElement).style.backgroundImage=updated;
     }
   }
   clone.style.width=rect.width+'px';
   clone.style.height=rect.height+'px';
   clone.style.maxWidth='none';
   clone.style.margin='0';
   const serialized=new XMLSerializer().serializeToString(clone);
   const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+rect.width+'" height="'+rect.height+'" viewBox="0 0 '+rect.width+' '+rect.height+'"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%">'+serialized+'</div></foreignObject></svg>';
   const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
   try{
     const image=new window.Image();
     image.src=url;
     await image.decode();
     const canvas=document.createElement('canvas');
     canvas.width=format.width;canvas.height=format.height;
     const context=canvas.getContext('2d');
     if(!context)throw new Error('Could not prepare the Studio image.');
     context.drawImage(image,0,0,canvas.width,canvas.height);
     const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Could not create the Studio PNG.')),'image/png'));
     const slug=selectedBook.work.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
     return {filename:`inkbound-${preferences.template}-${preferences.layout}-${slug}.png`,blob};
   }finally{URL.revokeObjectURL(url);}
 };
 const downloadImage=async()=>{try{const{filename,blob}=await createPng();await exportRuntimeBinaryFile({filename,mimeType:'image/png',contents:blob});setMessage('Studio card saved.')}catch(e){setMessage(e instanceof Error?e.message:'Export failed.')}}; const shareImage=async()=>{try{const{filename,blob}=await createPng();const result=await shareRuntimeBinaryFile({filename,mimeType:'image/png',contents:blob,title:'My Inkbound reading card',text:'Made with Inkbound'});setMessage(result==='shared'?'Share sheet opened.':'Sharing is unavailable here, so the card was saved instead.')}catch(e){setMessage(e instanceof Error?e.message:'Sharing was cancelled.')}};
 const compactFormat=preferences.format==='square'||preferences.format==='portrait'; const templateIcon=preferences.template==='quote-card'?<MessageSquareQuote className={`${compactFormat?'h-5 w-5':'h-6 w-6'} mx-auto mb-3`} style={{color:theme.accent}}/>:preferences.template==='review-card'?<Star className={`${compactFormat?'h-5 w-5':'h-6 w-6'} mx-auto mb-3`} style={{color:theme.accent}}/>:<Sparkles className={`${compactFormat?'h-5 w-5':'h-6 w-6'} mx-auto mb-3`} style={{color:theme.accent}}/>; const previewTitleSize=previewTitleRem(preferences.template,preferences.layout,preferences.format,cardCopy.title.length); const copyPreview=<div className="min-w-0">{templateIcon}<p className={`${compactFormat?'text-[9px] sm:text-[10px]':'text-[10px] sm:text-xs'} font-bold uppercase tracking-[0.22em]`} style={{color:theme.accent}}>{cardCopy.kicker}</p><h2 className="mt-3 font-serif font-bold leading-[1.08] [overflow-wrap:normal] [word-break:normal]" style={{fontSize:`${previewTitleSize}rem`}}>{cardCopy.title}</h2><p className={`${compactFormat?'mt-2 text-[11px] leading-4 sm:text-xs':'mt-3 text-xs leading-relaxed sm:text-sm'} mx-auto max-w-[96%] opacity-75 ${preferences.template==='review-card'?'line-clamp-6':''}`}>{cardCopy.body}</p><p className={`${compactFormat?'mt-2 text-[10px] sm:text-[11px]':'mt-3 text-[11px] sm:text-xs'} font-semibold`} style={{color:theme.accent}}>{cardCopy.footer}</p>{preferences.template==='reading-update'&&<div className={`${compactFormat?'mt-3':'mt-4'} mx-auto h-1.5 w-[80%] overflow-hidden rounded-full bg-white/10`}><div className="h-full rounded-full" style={{width:`${progress}%`,background:theme.accent}}/></div>}</div>;
 return <div className="min-w-0 space-y-7 overflow-x-hidden pb-24"><header><p className="inkbound-kicker">Create & Share</p><h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Inkbound Studio</h1><p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">Turn the reading life you already track into polished cards made to share.</p></header><div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,430px)_minmax(0,1fr)]"><section className="inkbound-panel min-w-0 space-y-5 rounded-3xl p-5 sm:p-7"><div><p className="text-sm font-semibold text-[var(--ink-ivory)]">Card style</p><div className="mt-2 grid grid-cols-2 gap-2">{(Object.entries(templates) as [CardTemplate,typeof templates[CardTemplate]][]).map(([id,item])=><button key={id} type="button" onClick={()=>setPreferences(c=>({...c,template:id}))} className={`rounded-xl border p-3 text-left ${preferences.template===id?'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)]':'border-[var(--ink-border)]'}`}><span className="block text-xs font-bold text-[var(--ink-ivory)]">{item.label}</span><span className="mt-1 block text-[11px] leading-4 text-[var(--ink-muted)]">{item.description}</span></button>)}</div></div><div><p className="text-sm font-semibold text-[var(--ink-ivory)]">Layout</p><div className="mt-2 grid gap-2">{(Object.entries(layouts) as [CardLayout,typeof layouts[CardLayout]][]).map(([id,item])=><button key={id} type="button" onClick={()=>setPreferences(c=>({...c,layout:id}))} className={`rounded-xl border p-3 text-left ${preferences.layout===id?'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)]':'border-[var(--ink-border)]'}`}><span className="block text-xs font-bold text-[var(--ink-ivory)]">{item.label}</span><span className="mt-1 block text-[11px] leading-4 text-[var(--ink-muted)]">{item.description}</span></button>)}</div></div><div><label htmlFor="studio-book-search" className="block text-sm font-semibold text-[var(--ink-ivory)]">Book</label><input id="studio-book-search" type="search" value={bookSearch} onChange={e=>setBookSearch(e.target.value)} placeholder="Search title, author, or series..." className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-sm text-[var(--ink-ivory)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--ink-gold)]"/><select value={selectedBook?.id??''} onChange={e=>{setPreferences(c=>({...c,selectedBookId:e.target.value,selectedQuoteId:''}));setBookSearch('')}} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-[var(--ink-ivory)]">{selectedBook&&!filteredShareableBooks.some(book=>book.id===selectedBook.id)&&<option value={selectedBook.id}>{selectedBook.work.title}</option>}{filteredShareableBooks.length>0?filteredShareableBooks.map(b=><option key={b.id} value={b.id}>{b.work.title}{b.work.author?` — ${b.work.author}`:''}</option>):<option value="" disabled>No matching books</option>}</select>{bookSearch&&<p className="mt-1 text-[11px] text-[var(--ink-muted)]">{filteredShareableBooks.length.toLocaleString()} matching {filteredShareableBooks.length===1?'book':'books'}</p>}{preferences.template==='quote-card'&&<div className="mt-3"><label htmlFor="studio-quote-select" className="block text-xs font-semibold text-[var(--ink-muted)]">Saved quote</label>{(selectedBook?.favoriteQuotes?.length??0)>0?<select id="studio-quote-select" value={selectedQuote?.id??''} onChange={e=>setPreferences(c=>({...c,selectedQuoteId:e.target.value}))} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-sm text-[var(--ink-ivory)]">{(selectedBook?.favoriteQuotes??[]).map(q=><option key={q.id} value={q.id}>{q.quote.length>72?`${q.quote.slice(0,69)}…`:q.quote}{q.pageOrChapter?` — ${q.pageOrChapter}`:''}</option>)}</select>:<p className="mt-2 rounded-xl border border-dashed border-[var(--ink-border)] px-3 py-3 text-xs leading-5 text-[var(--ink-muted)]">No saved quotes yet. Open this book and use the Quotes tab to save one.</p>}</div>}</div><div><p className="text-sm font-semibold text-[var(--ink-ivory)]">Format</p><div className="mt-2 grid grid-cols-2 gap-2">{(Object.entries(formats) as [ShareFormat,typeof formats[ShareFormat]][]).map(([id,item])=><button key={id} type="button" onClick={()=>setPreferences(c=>({...c,format:id}))} className={`min-h-11 rounded-xl border px-3 text-xs font-semibold ${preferences.format===id?'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]':'border-[var(--ink-border)] text-[var(--ink-muted)]'}`}>{item.label}</button>)}</div></div><div><p className="text-sm font-semibold text-[var(--ink-ivory)]">Theme</p><div className="mt-2 grid grid-cols-2 gap-2">{(Object.entries(themes) as [ShareTheme,typeof themes[ShareTheme]][]).map(([id,item])=><button key={id} type="button" onClick={()=>setPreferences(c=>({...c,theme:id}))} className={`inkbound-studio-theme-swatch min-h-11 rounded-xl border px-3 text-xs font-semibold ${preferences.theme===id?'border-[var(--ink-gold)]':'border-[var(--ink-border)]'}`} style={{'--studio-theme-background':item.background,'--studio-theme-text':item.text,'--studio-theme-accent':item.accent} as React.CSSProperties}>{item.label}</button>)}</div></div><div className="space-y-2"><p className="text-sm font-semibold text-[var(--ink-ivory)]">Details</p>{([['showRating','Show rating'],['showPages','Show page or audio length'],['showReadingTime','Show reading time']] as const).map(([key,label])=><label key={key} className="flex min-h-11 items-center justify-between gap-4 rounded-xl border border-[var(--ink-border-subtle)] px-4 text-sm text-[var(--ink-muted)]"><span>{label}</span><input type="checkbox" checked={preferences[key]} onChange={e=>setPreferences(c=>({...c,[key]:e.target.checked}))}/></label>)}</div><div className="grid gap-3 sm:grid-cols-2"><button type="button" disabled={!selectedBook} onClick={()=>void shareImage()} className="quiet-shelf-primary-action min-h-12 justify-center disabled:opacity-45"><Share2 className="h-4 w-4"/> Share</button><button type="button" disabled={!selectedBook} onClick={()=>void downloadImage()} className="quiet-shelf-secondary-action min-h-12 justify-center disabled:opacity-45"><Download className="h-4 w-4"/> Save PNG</button></div>{message&&<p role="status" className="break-words text-sm text-[var(--ink-muted)]">{message}</p>}</section><section className="inkbound-panel flex min-h-[460px] min-w-0 items-center justify-center overflow-hidden rounded-3xl p-4 sm:min-h-[640px] sm:p-8">{selectedBook?<div ref={previewRef} className="inkbound-studio-preview relative flex w-full max-w-[620px] flex-col overflow-hidden rounded-[28px] border border-white/15 p-[8%] text-center shadow-2xl" style={previewStyle}><div className="absolute inset-0 bg-black/25"/><div className={`inkbound-studio-preview-panel relative z-10 flex min-h-full flex-1 flex-col overflow-hidden rounded-3xl border border-white/10 bg-black/45 ${compactFormat?'p-6 sm:p-8':'p-7 sm:p-9'} backdrop-blur-[2px]`}><div><p className="text-[10px] font-bold uppercase tracking-[0.4em] sm:text-xs" style={{color:theme.accent}}>Inkbound</p><div className="mx-auto mt-5 h-1 w-1 rounded-full" style={{background:theme.accent}}/></div>{preferences.layout==='cover-focus'?<div className={`flex min-h-0 flex-1 flex-col items-center justify-center ${compactFormat?'py-5':'py-6'}`}>{coverUrl?<img src={coverUrl} alt="" className={`${compactFormat?'w-[24%]':'w-[30%]'} mb-5 aspect-[2/3] h-auto shrink-0 object-contain rounded-2xl object-cover shadow-2xl`}/>:<div className={`${compactFormat?'w-[42%]':'w-[48%]'} mb-4 flex aspect-[2/3] items-center justify-center rounded-2xl border border-white/10 bg-white/5 font-serif text-sm opacity-50`}>Cover unavailable</div>}<div className="w-full min-w-0 text-center">{copyPreview}</div></div>:preferences.layout==='editorial'?<div className={`grid min-h-0 flex-1 ${compactFormat?'grid-cols-[31%_1fr] gap-4 py-2':'grid-cols-[32%_1fr] gap-5 py-4'} items-center overflow-hidden text-left`}>{coverUrl?<img src={coverUrl} alt="" className="aspect-[2/3] max-h-[58%] w-full rounded-2xl object-cover shadow-2xl"/>:<div className="flex aspect-[2/3] w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-3 text-center font-serif text-xs opacity-50">Cover unavailable</div>}<div className="min-w-0">{copyPreview}</div></div>:<div className={`flex min-h-0 flex-1 items-center justify-center overflow-hidden ${compactFormat?'py-2':'py-5'} text-center`}><div className="w-full min-w-0">{copyPreview}</div></div>}<p className="mt-5 shrink-0 text-[10px] font-semibold opacity-60 sm:text-xs">Made with Inkbound</p></div></div>:<div className="text-center"><Image className="mx-auto h-10 w-10 text-[var(--ink-gold)]"/><p className="mt-3 text-sm text-[var(--ink-muted)]">Add or start a book to create your first share card.</p></div>}</section></div></div>;
};