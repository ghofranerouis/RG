// ============================
// تحميل JSON وبناء نموذج البحث الهجين
// ============================
let books = [];
let userContext = { lastBook:null, interests:{} };
let corpusBuilt = false;

// تحميل JSON عند التحميل
window.addEventListener('load', async () => {
  try {
    const res = await fetch('books.json');
    books = await res.json();

    const savedContext = localStorage.getItem('userContext_v1');
    if(savedContext) userContext = JSON.parse(savedContext);

    corpusBuilt = true; 
    loadChatHistory();
    addMessage('bot','👋 أهلاً! أنا مساعدك الذكي لاقتراحات الكتب. اكتب كلمة مفتاحية، أو جرّب "من أنت؟" أو "اقترح لي".');
  } catch(e){
    console.error('تعذّر تحميل الكتب:', e);
  }
});

// ---------------------------
// أدوات النصوص
// ---------------------------
function cleanText(text){
    if (!text) return "";
    // تنظيف النص عن طريق إزالة الترقيم والحركات والأرقام، وتوحيد الأحرف للحصول على تطابق أفضل.
    return text.toLowerCase()
        .replace(/[\u0660-\u0669\u0030-\u0039\u064B-\u0652\.\,\!\?\;\:\(\)\"\'\-\–\—]/g,' ');
}

// ---------------------------
// دالة البحث الهجين الجديدة (تم تصحيح مشكلة الاستعلام الفارغ)
// ---------------------------
function searchHybrid(query, topN = 6) {
    if (!corpusBuilt) return [];

    const cleanQuery = cleanText(query).trim();

    // ⛔️ التصحيح هنا: نسمح بالاستعلام الفارغ (cleanQuery.length === 0)
    // الاستعلام الفارغ يعني طلب اقتراح عام يعتمد فقط على عامل التعزيز (Boosting)
    const isGeneralSuggestion = cleanQuery.length < 2; 

    const scores = books.map(book => {
        let score = 0;
        const cQ = cleanQuery;

        // 1. حساب الوزن بناءً على تطابق الكلمات (فقط إذا كان هناك استعلام)
        if (!isGeneralSuggestion) {
            
            // أ. تطابق العنوان والكلمات المفتاحية (أولوية عالية)
            if (cleanText(book.title).includes(cQ)) score += 5;
            if (book.keywords && book.keywords.some(k => cleanText(k).includes(cQ))) score += 4;
            
            // ب. تطابق الملخص والمجال (أولوية متوسطة)
            if (cleanText(book.summary).includes(cQ)) score += 3;
            if (cleanText(book.field).includes(cQ)) score += 2;
            
            // ج. تطابق جزئي للكلمات
            if (score === 0) {
                const queryWords = cQ.split(/\s+/).filter(w => w.length > 2);
                for (const word of queryWords) {
                    if (cleanText(book.title).includes(word)) score += 1.5;
                    if (book.keywords && book.keywords.some(k => cleanText(k).includes(word))) score += 1;
                }
            }
        }
        
        // 2. تعزيز السياق (Boosting): يُطبق دائماً حتى لو لم يكن هناك استعلام بحث
        const boost = userContext.interests[book.field] || 0;
        if (boost > 0) score += (boost * 1.5); 

        // 3. إذا كان طلب اقتراح عام (isGeneralSuggestion) وليس هناك تعزيز، نعطي الكتاب قيمة أساسية.
        if (isGeneralSuggestion && score === 0) {
             score += 0.5; // قيمة أساسية للسماح بالظهور في الاقتراحات العامة
        }

        // 4. إضافة تشتيت بسيط للفرز النهائي
        if (score > 0) score += Math.random() * 0.001; 
        
        return { book, score };
    });

    // فرز النتائج تنازلياً وتصفية النتائج الصفرية (إلا إذا كانت طلب اقتراح عام)
    scores.sort((a, b) => b.score - a.score);
    
    // في حالة الاستعلام العام، نأخذ أفضل النتائج حتى لو كانت درجاتها منخفضة (لكن > 0)
    if (isGeneralSuggestion) {
        return scores.slice(0, topN).filter(s => s.score > 0).map(s => s.book);
    }
    
    // في حالة البحث المحدد، نأخذ فقط النتائج ذات التوافق العالي
    return scores.slice(0, topN).filter(s => s.score > 1).map(s => s.book);
}

// ---------------------------
// وظيفة معالجة الأسئلة المباشرة
// ---------------------------
function handleDirectQueries(q){
    // 1. أوامر التحكم
    if(['مسح الاهتمامات', 'مسح سياقي', 'صفر اهتمامات'].includes(q)){
        resetUserInterests();
        return true;
    }
    // ⛔️ التصحيح: عند الاقتراح العام، نمرر استعلام فارغ ('')
    if(q==='اقترح' || q==='اقترح لي' || q==='ماذا تقترح'){
        const recs = searchHybrid('',5); 
        addMessage('bot',`📚 هذه ${recs.length} اقتراحات قد تعجبك (بناءً على اهتماماتك):`); 
        recs.forEach(b=>addBookResult(b)); 
        return true;
    }

    // 2. الردود العامة
    if(['مرحبا', 'السلام عليكم', 'سلام', 'أهلاً', 'أهلا'].includes(q)){
        addMessage('bot','وعليكم السلام ورحمة الله. كيف يمكنني مساعدتك اليوم في اختيار كتابك؟');
        return true;
    }
    if(['من أنت؟', 'من انت'].includes(q)){
        addMessage('bot','أنا مساعد ذكي لإقتراح الكتب. لدي قاعدة بيانات تحتوي على عناوين مختلفة يمكنني البحث فيها بناءً على اهتماماتك أو كلماتك المفتاحية.');
        return true;
    }
    
    // 3. أسئلة متعلقة ببيانات books.json (يتم البحث هنا بالنص الكامل)
    let targetBook = null;
    const cleanQ = cleanText(q);

    // البحث عن عنوان الكتاب بالكامل في الاستعلام
    for(const book of books){
        if(cleanQ.includes(cleanText(book.title))){
            targetBook = book;
            break;
        }
    }

    if(targetBook){
        // الرد على سؤال عن المؤلف
        if(cleanQ.includes('مؤلف') || cleanQ.includes('كاتب')){
            addMessage('bot', `✍️ مؤلف كتاب "${targetBook.title}" هو: **${targetBook.author||'غير معروف'}**.`);
            return true;
        }
        // الرد على سؤال عن المجال
        if(cleanQ.includes('مجال') || cleanQ.includes('تخصص')){
            addMessage('bot', `🏷️ يقع كتاب "${targetBook.title}" في مجال: **${targetBook.field||'غير محدد'}**.`);
            return true;
        }
    }
    
    return false;
}

// ---------------------------
// إدارة سياق المستخدم
// ---------------------------
function resetUserInterests(){
    userContext.interests = {};
    saveUserContext();
    addMessage('bot', '🗑️ تم مسح جميع اهتماماتك. الاقتراحات القادمة ستكون محايدة.');
}
function saveChatHistory(){ const chat=document.getElementById("results").innerHTML; localStorage.setItem("chatHistory",chat); }
function loadChatHistory(){ const saved=localStorage.getItem("chatHistory"); if(saved) document.getElementById("results").innerHTML=saved; }
function saveUserContext(){ localStorage.setItem("userContext_v1",JSON.stringify(userContext)); }

// ---------------------------
// DOM: عرض الرسائل والكتب
// ---------------------------
function addMessage(sender,text){
  const box=document.getElementById("results"); if(!box) return;
  const div=document.createElement("div");
  div.classList.add("message",sender);
  div.innerText=text;
  box.appendChild(div);
  box.scrollTop=box.scrollHeight;
  saveChatHistory();
}

function addBookResult(book){
  const box = document.getElementById("results");
  if(!box) return;
  const container = document.createElement("div");
  container.classList.add("message","bot"); container.style.maxWidth="90%";

  const title=document.createElement("div"); title.innerText=book.title+' — '+(book.author||''); title.style.fontWeight="700";
  const field=document.createElement("div"); field.innerText='المجال: '+book.field; field.style.fontSize='12px'; field.style.opacity=0.9;
  const summary=document.createElement("div"); summary.innerText=book.summary||''; summary.style.marginTop='6px';

  const actions=document.createElement("div"); actions.style.marginTop='8px'; actions.style.display='flex'; actions.style.gap='8px';
  
  // الأزرار التفاعلية
  const btnSummary=document.createElement("button"); btnSummary.innerText='ملخّص'; 
  btnSummary.onclick=()=>addMessage('bot',`📘 ملخّص "${book.title}":\n${book.summary||'لا يوجد ملخص.'}`);
  const btnToc=document.createElement("button"); btnToc.innerText='الفهرس'; 
  btnToc.onclick=()=>addMessage('bot',`📑 فهرس "${book.title}":\n- ${ (book.toc||[]).join('\n- ') }`);
  const btnLikeField=document.createElement("button"); btnLikeField.innerText='مهتم بهذا المجال'; 
  btnLikeField.onclick=()=>{
    userContext.interests[book.field]=(userContext.interests[book.field]||0)+1; saveUserContext();
    addMessage('bot',`✅ تم تسجيل اهتمامك بالمجال "${book.field}". (الاهتمام الحالي: ${userContext.interests[book.field]})`);
  };
  
  [btnSummary,btnToc,btnLikeField].forEach(b=>{b.style.padding='6px 10px'; b.style.borderRadius='8px'; b.style.border='none'; b.style.cursor='pointer';});
  actions.appendChild(btnSummary); actions.appendChild(btnToc); actions.appendChild(btnLikeField);

  container.appendChild(title); container.appendChild(field); container.appendChild(summary); container.appendChild(actions);
  box.appendChild(container);
  box.scrollTop=box.scrollHeight; saveChatHistory();
}

// ---------------------------
// إرسال الرسائل ومعالجة البحث
// ---------------------------
function sendMessage(){
  const input=document.getElementById("question");
  if(!input) return; const text=input.value.trim(); if(!text) return;
  
  addMessage('user',text);
  input.value=''; // مسح الإدخال فوراً

  const q = cleanText(text).trim(); // استخدام دالة التنظيف الجديدة هنا

  addMessage('bot','...المساعد يفكّر');

  setTimeout(()=>{
    // إزالة رسالة "يفكّر" الأخيرة
    const box=document.getElementById("results");
    const msgs = box.querySelectorAll('.message.bot');
    if(msgs.length){ const lastBot = msgs[msgs.length-1]; if(lastBot && lastBot.innerText==='...المساعد يفكّر') lastBot.remove(); }

    // 1. معالجة الردود التفاعلية أولاً
    if(handleDirectQueries(q)){
        return; 
    }

    // 2. إذا لم يكن سؤال مباشر، يتم التعامل معه كاستعلام بحث (البحث الهجين)
    const results = searchHybrid(text,6);
    if(results.length===0){ 
        addMessage('bot','❌ لم أجد نتائج مطابقة لاستعلامك. جرّب كلمات مفتاحية أخرى.'); 
        return; 
    }

    addMessage('bot',`🔍 وجدت ${results.length} كتاباً مناسباً:`); 
    results.forEach(b=>addBookResult(b));

    // تحديث السياق
    userContext.lastBook = results[0] || userContext.lastBook;
    if(results[0]) {
        userContext.interests[results[0].field]=(userContext.interests[results[0].field]||0)+1;
    }
    saveUserContext();

  },350);
}
