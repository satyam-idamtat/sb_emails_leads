/* AVIONICS DIRECTORY — fixed filtering, sorting, validation and data handling */
const COMPANY_DATA_KEY="avionicsCompaniesV1";
function loadCompanies(){
    return [];
}
function saveCompanies(){
    if(!currentUser) return Promise.resolve();
    const snapshot=allCompanies.map(company=>({...company}));
    companySaveQueue=companySaveQueue.then(()=>fetch("/api/companies",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({companies:snapshot})}))
      .then(async r=>{if(!r.ok)throw new Error("Could not save company changes");const data=await r.json();if(currentUser.role==="user"&&Array.isArray(data.companies)){allCompanies=data.companies;nextId=Math.max(0,...allCompanies.map(c=>Number(c["#"])||0))+1}})
      .catch(err=>{console.error(err);showToast("Save failed — refresh and try again")});
    return companySaveQueue;
}
let allCompanies = loadCompanies();
let currentUser=null;
let companySaveQueue=Promise.resolve();
let filteredCompanies = [];
let currentPage = 1;
let rowsPerPage = 25;
let sortField = "Company Name";
let sortDirection = "asc";
let selectedCompany = null;
let editMode = false;
let selectedIds = new Set();
let nextId = Math.max(0, ...allCompanies.map(c => Number(c["#"]) || 0)) + 1;

const $ = id => document.getElementById(id);
function requireAdmin(){if(currentUser?.role==="admin")return true;showToast("Admin permission required");return false}
const THEME_KEY="avionicsDirectoryThemeV1";
const themeOptions=[...document.querySelectorAll("[data-theme-option]")];
function applyTheme(theme){
    const selected=["dark","light","pink"].includes(theme)?theme:"dark";
    document.body.dataset.theme=selected;
    themeOptions.forEach(option=>{
        const active=option.dataset.themeOption===selected;
        option.classList.toggle("active",active);
        option.querySelector("input").checked=active;
    });
    localStorage.setItem(THEME_KEY,selected);
}
applyTheme(localStorage.getItem(THEME_KEY)||"dark");
themeOptions.forEach(option=>option.querySelector("input").addEventListener("change",()=>applyTheme(option.dataset.themeOption)));
const backgroundVideo=$("backgroundVideo"),videoBackgroundShade=$("videoBackgroundShade");
let backgroundAudioStarted=false;
let backgroundMediaFinished=false;
function enableBackgroundAudio(){
    if(backgroundAudioStarted||backgroundMediaFinished)return;
    backgroundVideo.classList.remove("is-finished");
    videoBackgroundShade.classList.remove("is-finished");
    backgroundVideo.muted=false;
    backgroundVideo.volume=.12;
    backgroundVideo.currentTime=0;
    backgroundVideo.play().then(()=>{
        backgroundAudioStarted=true;
        sessionStorage.removeItem("playBackgroundIntro");
    }).catch(()=>{
        backgroundAudioStarted=false;
        backgroundVideo.muted=true;
        backgroundVideo.play().catch(()=>{});
    });
}
document.addEventListener("pointerdown",enableBackgroundAudio);
document.addEventListener("keydown",enableBackgroundAudio);
if(sessionStorage.getItem("playBackgroundIntro")) enableBackgroundAudio();
backgroundVideo.addEventListener("ended",()=>{
    backgroundMediaFinished=true;
    backgroundVideo.classList.add("is-finished");
    videoBackgroundShade.classList.add("is-finished");
    document.body.classList.add("background-image-active");
});
const tableBody=$("companyTable"), showingCount=$("showingCount"), allCount=$("allCount"), totalCompanies=$("totalCompanies");
const manufacturerCount=$("manufacturerCount"), distributorCount=$("distributorCount"), sourceBuddyCount=$("sourceBuddyCount");
const pageInfo=$("pageInfo"), prevBtn=$("prevPage"), nextBtn=$("nextPage"), selectAllBox=$("selectAll"), bulkBar=$("bulkBar"), selectedCountEl=$("selectedCount");
const searchInput=$("searchInput"), manufacturerFilter=$("manufacturerFilter"), distributorFilter=$("distributorFilter"), sourceBuddyFilter=$("sourceBuddyFilter"), verticalFilter=$("verticalFilter");
const emailFilter=$("emailFilter"), phoneFilter=$("phoneFilter"), websiteFilter=$("websiteFilter"), linkedinFilter=$("linkedinFilter"), statusFilter=$("statusFilter"), duplicateFilter=$("duplicateFilter");
const mailStatusFilter=$("mailStatusFilter");
const sortBy=$("sortBy"), sortDirectionBtn=$("sortDirection"), pageSize=$("pageSize"), resetBtn=$("resetBtn"), activeFilters=$("activeFilters");

function escapeHtml(v){ return v==null?"":String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function clean(v){ const s=String(v??"").trim(); return s==="0"?"":s; }
function normalizeBoolean(v){
    const s=String(v??"").trim().toLowerCase();
    return ["yes","y","true","1"].includes(s) ? "yes" : "no";
}
function primaryName(c){ return clean(c["Name"]) || clean(c["POC 1"]); }
function primaryEmail(c){ return clean(c["Email.1"]) || clean(c["Email"]); }
function primaryPhone(c){ return clean(c["Number"]) || clean(c["Phone."]); }
function website(c){ return clean(c["Unnamed: 2"]) || clean(c["Website"]); }
function linkedin(c){ return clean(c["LinkedIN"]) || clean(c["LinkedIn"]); }
function companyKey(v){ return clean(v).toLowerCase().replace(/&/g,"and").replace(/\b(pvt|private|limited|ltd|llp|inc|corp|corporation|company|co)\b\.?/g,"").replace(/[^a-z0-9]/g,""); }
function duplicateCounts(){ const m=new Map(); allCompanies.forEach(c=>{const k=companyKey(c["Company Name"]); if(k)m.set(k,(m.get(k)||0)+1)}); return m; }
function isComplete(c){ return Boolean(clean(c["Company Name"]) && website(c) && primaryName(c) && primaryEmail(c) && primaryPhone(c)); }
function hasValue(value, wanted){ return !wanted || (wanted==="yes" ? Boolean(clean(value)) : !clean(value)); }

const MAIL_STATE_KEY="avionicsMailStateV1";
const MAIL_TEMPLATE_KEY="avionicsMailTemplatesDay1V1";
const MAIL_SENDER_KEY="avionicsApprovedSenderV1";
let approvedSender=localStorage.getItem(MAIL_SENDER_KEY)||"";
const DEFAULT_TEMPLATES={
    manufacturer:{
        subject:"Customer didn't complain. They just stopped calling",
        body:"{{greeting}}\n\nThere's a revenue leak most manufacturing companies never track.\n\nA customer sends an enquiry. Sourcing gets delayed but finally the quote goes out. No response.\n\nThey don't say your price was wrong. They just quietly moved the order — and slowly stopped sending enquiries.\n\nQuick question — Do you know what is the revenue lost due to delayed RFQ responses?\n\nBook a meeting to know more: https://cal.com/suhaas-idamtat-lzk0ft/let-s-connect-source-buddy\n\nAnurag Kumar\nIdamTat Technologies and Services LLP\n+91 8431910393\nwww.idamtat.in"
    },
    distributor:{
        subject:"How much revenue did you lose to a delayed quote this week?",
        body:"{{greeting}}\n\nIn components trading, the fastest and most accurate quote wins the order.\n\nWhen a BOM lands in your inbox, how long does your team take to check stock availability, lead times, and best price — before you can even quote? That delay is costing you orders.\n\nSource Buddy is built for traders like you — to pull multi-vendor pricing fast, compare quotes side by side, and respond before your competitor even finishes checking with suppliers.\n\nWorth a 20-minute conversation?\n\nBook a meeting to know more: https://cal.com/suhaas-idamtat-lzk0ft/let-s-connect-source-buddy\n\nWarm regards,\nAnurag Kumar\nIdam TAT — Source Buddy\n+91 8431910393\nwww.idamtat.in"
    }
};
let mailState=JSON.parse(localStorage.getItem(MAIL_STATE_KEY)||"{}");
let mailTemplates=JSON.parse(localStorage.getItem(MAIL_TEMPLATE_KEY)||"null")||DEFAULT_TEMPLATES;
let mailingCompany=null;
let mailingQueue=[];
let mailingQueueIndex=-1;
function saveMailState(){localStorage.setItem(MAIL_STATE_KEY,JSON.stringify(mailState))}
function saveMailTemplates(){localStorage.setItem(MAIL_TEMPLATE_KEY,JSON.stringify(mailTemplates))}
function mailStatus(c){if(!primaryEmail(c))return"no-email";return mailState[String(c["#"])]?.status==="sent"?"sent":"not-sent"}
function isReadyToMail(c){return Boolean(primaryEmail(c)&&templateTypeFor(c)&&mailStatus(c)!=="sent")}
function templateTypeFor(c){
    const m=normalizeBoolean(c["Manufacturer"])==="yes",d=normalizeBoolean(c["Distributor"])==="yes";
    if(m&&!d)return"manufacturer";
    if(d&&!m)return"distributor";
    return null;
}
const GENERIC_MAILBOX_NAMES=new Set(["accounts","admin","billing","careers","contact","contactus","customercare","customerservice","enquiry","enquiries","help","hello","hr","info","inquiry","inquiries","marketing","office","orders","sales","service","support","team"]);
function companyNameForTeamGreeting(companyName){
    const name=clean(companyName);
    const hasLegalSuffix=/\b(pvt\.?\s*ltd\.?|private\s+limited|ltd\.?|limited|llp|inc\.?|corp\.?|corporation|company)\b/i.test(name);
    return hasLegalSuffix?name:`${name} Pvt. Ltd.`;
}
function greetingFor(c){
    const contactName=primaryName(c)||"";
    const nameWithoutPrefix=contactName.replace(/^(mr|mrs|ms|dr)\.?\s*/i,"").trim();
    const firstName=nameWithoutPrefix.split(/\s+/)[0]||"";
    const emailUsername=primaryEmail(c).split("@")[0].toLowerCase();
    const emailParts=emailUsername.split(/[._-]+/).filter(Boolean);
    const normalizedEmailUsername=emailUsername.replace(/[._-]/g,"");
    const isGenericMailbox=emailParts.some(part=>GENERIC_MAILBOX_NAMES.has(part));
    const nameParts=nameWithoutPrefix.toLowerCase().split(/[^a-z0-9]+/).filter(part=>part.length>1);
    const emailMatchesPoc=nameParts.some(part=>normalizedEmailUsername.includes(part));
    const emailNamePart=emailParts.find(part=>/^[a-z]{2,}$/.test(part)&&!GENERIC_MAILBOX_NAMES.has(part));
    const emailFirstName=emailNamePart?`${emailNamePart.charAt(0).toUpperCase()}${emailNamePart.slice(1)}`:"";
    if(isGenericMailbox)return `Hi Team at ${companyNameForTeamGreeting(c["Company Name"])},`;
    if(emailMatchesPoc&&firstName)return `Hi ${firstName},`;
    if(emailFirstName)return `Hi ${emailFirstName},`;
    return `Hi Team at ${companyNameForTeamGreeting(c["Company Name"])},`;
}
function fillTemplate(text,c){
    const name=primaryName(c)||"";
    const firstName=name.replace(/^(mr|mrs|ms|dr)\.?\s*/i,"").trim().split(/\s+/)[0]||"";
    const companyName=clean(c["Company Name"]);
    const vars={contact_name:name,first_name:firstName,company_name:companyName,email:primaryEmail(c),vertical:clean(c["Vertical"]),greeting:greetingFor(c)};
    return String(text||"").replace(/\{\{(\w+)\}\}/g,(m,k)=>vars[k]??m);
}
function mailStatusBadge(c){
    const s=mailStatus(c);
    if(s==="sent")return'<span class="mail-status sent">SENT</span>';
    if(s==="no-email")return'<span class="mail-status no-email">NO EMAIL</span>';
    return isReadyToMail(c)?'<span class="mail-status ready">MAIL</span>':'<span class="mail-status pending">CHECK DATA</span>';
}


function calculateKPIs(){
    totalCompanies.textContent=allCompanies.length;
    manufacturerCount.textContent=allCompanies.filter(c=>normalizeBoolean(c["Manufacturer"])==="yes").length;
    distributorCount.textContent=allCompanies.filter(c=>normalizeBoolean(c["Distributor"])==="yes").length;
    sourceBuddyCount.textContent=allCompanies.filter(c=>normalizeBoolean(c["Source Buddy"])==="yes").length;
    allCount.textContent=allCompanies.length;
}
function badge(v){ return normalizeBoolean(v)==="yes"?'<span class="badge green">YES</span>':'<span class="badge gray">NO</span>'; }
function safeLink(raw){ const v=clean(raw); if(!v)return ""; const href=/^https?:\/\//i.test(v)?v:`https://${v}`; return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Visit</a>`; }
function websiteLink(raw){ const v=clean(raw); if(!v)return "-"; const href=/^https?:\/\//i.test(v)?v:`https://${v}`; return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(v)}</a>`; }

function populateVerticalFilter(){
    const current=verticalFilter.value;
    const vals=[...new Set(allCompanies.map(c=>clean(c["Vertical"])).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:"base"}));
    verticalFilter.innerHTML='<option value="">All</option>';
    vals.forEach(v=>{const o=document.createElement("option");o.value=v;o.textContent=v;verticalFilter.appendChild(o)});
    verticalFilter.value=vals.includes(current)?current:"";
}

function searchableText(c){ return [c["Company Name"],primaryName(c),primaryEmail(c),primaryPhone(c),c["Vertical"]].map(clean).join(" ").toLowerCase(); }
function applyFilters(){
    const keyword=searchInput.value.trim().toLowerCase();
    const duplicateMap=duplicateCounts();
    filteredCompanies=allCompanies.filter(c=>{
        const isDup=(duplicateMap.get(companyKey(c["Company Name"]))||0)>1;
        return (!keyword || searchableText(c).includes(keyword))
            && (!manufacturerFilter.value || normalizeBoolean(c["Manufacturer"])===manufacturerFilter.value.toLowerCase())
            && (!distributorFilter.value || normalizeBoolean(c["Distributor"])===distributorFilter.value.toLowerCase())
            && (!sourceBuddyFilter.value || normalizeBoolean(c["Source Buddy"])===sourceBuddyFilter.value.toLowerCase())
            && (!verticalFilter.value || clean(c["Vertical"])===verticalFilter.value)
            && hasValue(primaryEmail(c),emailFilter.value)
            && hasValue(primaryPhone(c),phoneFilter.value)
            && hasValue(website(c),websiteFilter.value)
            && hasValue(linkedin(c),linkedinFilter.value)
            && (!statusFilter.value || (statusFilter.value==="complete" ? isComplete(c) : !isComplete(c)))
            && (!duplicateFilter.value || (duplicateFilter.value==="yes" ? isDup : !isDup))
            && (!mailStatusFilter.value
                || (mailStatusFilter.value==="ready" && isReadyToMail(c))
                || (mailStatusFilter.value==="not-sent" && mailStatus(c)==="not-sent")
                || (mailStatusFilter.value==="sent" && mailStatus(c)==="sent")
                || (mailStatusFilter.value==="no-email" && mailStatus(c)==="no-email"));
    });
    currentPage=1;
    applySorting(false);
    renderActiveFilters();
}
function applySorting(render=true){
    filteredCompanies.sort((a,b)=>{
        let A=sortValue(a,sortField), B=sortValue(b,sortField);
        const result=String(A).localeCompare(String(B),undefined,{numeric:true,sensitivity:"base"});
        return sortDirection==="asc"?result:-result;
    });
    if(render) renderTable(); else renderTable();
    updateSortUI();
}
function sortValue(c,field){ if(field==="Name")return primaryName(c); if(field==="Email.1")return primaryEmail(c); if(field==="Number")return primaryPhone(c); return c[field]??""; }
function updateSortUI(){
    if(sortDirectionBtn) sortDirectionBtn.innerHTML=sortDirection==="asc"?'<i class="fa-solid fa-arrow-up-a-z"></i> ASC':'<i class="fa-solid fa-arrow-down-z-a"></i> DESC';
    document.querySelectorAll("thead th").forEach(th=>{th.classList.remove("sort-active"); const a=th.querySelector(".sort-arrow"); if(a)a.remove()});
    const map={"#":1,"Company Name":2,"Unnamed: 2":3,"Manufacturer":4,"Distributor":5,"Source Buddy":6,"Name":7,"Email.1":8,"Number":9};
    const th=document.querySelectorAll("thead th")[map[sortField]];
    if(th){th.classList.add("sort-active"); const span=document.createElement("span");span.className="sort-arrow";span.textContent=sortDirection==="asc"?"↑":"↓";th.appendChild(span)}
}

function renderTable(){
    tableBody.innerHTML="";
    const effectiveRows=rowsPerPage===Infinity?Math.max(filteredCompanies.length,1):rowsPerPage;
    const start=(currentPage-1)*effectiveRows, pageData=filteredCompanies.slice(start,start+effectiveRows);
    pageData.forEach(c=>{
        const id=c["#"], tr=document.createElement("tr"); if(selectedIds.has(id))tr.classList.add("selected");
        tr.innerHTML=`<td class="checkbox-col"><input type="checkbox" data-id="${escapeHtml(id)}" ${selectedIds.has(id)?"checked":""}></td><td>${escapeHtml(id)}</td><td class="company">${escapeHtml(c["Company Name"])}</td><td>${safeLink(website(c))}</td><td>${badge(c["Manufacturer"])}</td><td>${badge(c["Distributor"])}</td><td>${badge(c["Source Buddy"])}</td><td>${escapeHtml(primaryName(c))}</td><td>${escapeHtml(primaryEmail(c))}</td><td>${escapeHtml(primaryPhone(c))}</td><td><button class="row-mail-btn ${mailStatus(c)==="sent"?"sent":""}" data-mail-id="${escapeHtml(id)}" ${!isReadyToMail(c)&&mailStatus(c)!=="sent"?"disabled":""}>${mailStatusBadge(c)}</button></td>`;
        tr.querySelector("input").addEventListener("click",e=>{e.stopPropagation();toggleSelect(id,e.target.checked)});
        const mailBtn=tr.querySelector(".row-mail-btn");mailBtn.addEventListener("click",e=>{e.stopPropagation();openMailPreview(c)});
        tr.addEventListener("click",()=>openCompany(c)); tableBody.appendChild(tr);
    });
    showingCount.textContent=filteredCompanies.length; allCount.textContent=allCompanies.length; updatePagination(); updateSelectAllState();
}
function updatePagination(){ const rp=rowsPerPage===Infinity?Math.max(filteredCompanies.length,1):rowsPerPage; const pages=Math.max(1,Math.ceil(filteredCompanies.length/rp)); if(currentPage>pages)currentPage=pages; pageInfo.textContent=`Page ${currentPage} of ${pages}`; prevBtn.disabled=currentPage===1; nextBtn.disabled=currentPage>=pages; }
prevBtn.onclick=()=>{if(currentPage>1){currentPage--;renderTable()}};
nextBtn.onclick=()=>{const rp=rowsPerPage===Infinity?Math.max(filteredCompanies.length,1):rowsPerPage;if(currentPage<Math.ceil(filteredCompanies.length/rp)){currentPage++;renderTable()}};

const filterControls=[searchInput,manufacturerFilter,distributorFilter,sourceBuddyFilter,verticalFilter,emailFilter,phoneFilter,websiteFilter,linkedinFilter,statusFilter,duplicateFilter,mailStatusFilter];
filterControls.forEach(el=>el.addEventListener(el===searchInput?"input":"change",applyFilters));
if(sortBy) sortBy.addEventListener("change",()=>{sortField=sortBy.value;sortDirection="asc";applySorting()});
if(sortDirectionBtn) sortDirectionBtn.addEventListener("click",()=>{sortDirection=sortDirection==="asc"?"desc":"asc";applySorting()});
pageSize.addEventListener("change",()=>{rowsPerPage=pageSize.value==="all"?Infinity:Number(pageSize.value);currentPage=1;renderTable()});
resetBtn.addEventListener("click",resetFilters);
function resetFilters(){ filterControls.forEach(el=>el.value=""); sortField="Company Name";sortDirection="asc";if(sortBy)sortBy.value=sortField;currentPage=1;applyFilters(); }

const chipDefs=[[searchInput,"Search"],[manufacturerFilter,"Manufacturer"],[distributorFilter,"Distributor"],[sourceBuddyFilter,"Source Buddy"],[verticalFilter,"Vertical"],[emailFilter,"Has Email"],[phoneFilter,"Has Phone"],[websiteFilter,"Has Website"],[linkedinFilter,"Has LinkedIn"],[statusFilter,"Status"],[duplicateFilter,"Duplicate"],[mailStatusFilter,"Mail Status"]];
function renderActiveFilters(){
    activeFilters.innerHTML="";
    chipDefs.forEach(([el,label])=>{if(!el.value)return; const chip=document.createElement("span");chip.className="filter-chip";chip.innerHTML=`${escapeHtml(label)}: ${escapeHtml(el.value)} <button title="Remove filter">×</button>`;chip.querySelector("button").onclick=()=>{el.value="";applyFilters()};activeFilters.appendChild(chip)});
    if(activeFilters.children.length){const clear=document.createElement("button");clear.className="btn-ghost-sm";clear.textContent="Clear All Filters";clear.onclick=resetFilters;activeFilters.appendChild(clear)}
}

document.querySelectorAll("thead th").forEach((th,index)=>{if(th.classList.contains("checkbox-col"))return;th.onclick=()=>{const map={1:"#",2:"Company Name",3:"Unnamed: 2",4:"Manufacturer",5:"Distributor",6:"Source Buddy",7:"Name",8:"Email.1",9:"Number"};if(!map[index])return;if(sortField===map[index])sortDirection=sortDirection==="asc"?"desc":"asc";else{sortField=map[index];sortDirection="asc"}if(sortBy)sortBy.value=[...sortBy.options].some(o=>o.value===sortField)?sortField:sortBy.value;applySorting()}});

function currentPageCompanies(){const rp=rowsPerPage===Infinity?Math.max(filteredCompanies.length,1):rowsPerPage;const start=(currentPage-1)*rp;return filteredCompanies.slice(start,start+rp)}
function toggleSelect(id,checked){checked?selectedIds.add(id):selectedIds.delete(id);updateBulkBar();updateSelectAllState();const row=[...tableBody.children].find(tr=>tr.querySelector(`input[data-id="${CSS.escape(String(id))}"]`));if(row)row.classList.toggle("selected",checked)}
function updateSelectAllState(){const ids=currentPageCompanies().map(c=>c["#"]);selectAllBox.checked=ids.length>0&&ids.every(id=>selectedIds.has(id));selectAllBox.indeterminate=ids.some(id=>selectedIds.has(id))&&!selectAllBox.checked}
selectAllBox.addEventListener("change",()=>{currentPageCompanies().forEach(c=>selectAllBox.checked?selectedIds.add(c["#"]):selectedIds.delete(c["#"]));renderTable();updateBulkBar()});
function updateBulkBar(){selectedCountEl.textContent=selectedIds.size;bulkBar.classList.toggle("show",selectedIds.size>0)}
$("bulkClear").onclick=()=>{selectedIds.clear();renderTable();updateBulkBar()};
$("bulkCopyEmails").onclick=()=>{const emails=allCompanies.filter(c=>selectedIds.has(c["#"])).map(primaryEmail).filter(Boolean);navigator.clipboard.writeText(emails.join(", "));showToast(`${emails.length} email(s) copied`)};
$("bulkExport").onclick=()=>downloadCsv(allCompanies.filter(c=>selectedIds.has(c["#"])),"selected-companies.csv");
$("bulkDelete").onclick=()=>{if(!requireAdmin()||!confirm(`Delete ${selectedIds.size} selected companies? This cannot be undone.`))return;allCompanies=allCompanies.filter(c=>!selectedIds.has(c["#"]));selectedIds.clear();refreshData();updateBulkBar();showToast("Selected companies deleted")};

function toCsvValue(v){const s=String(v??"");return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function downloadCsv(rows,filename){if(!rows.length){showToast("Nothing to export");return}const headers=[...new Set(rows.flatMap(Object.keys))];const lines=[headers.map(toCsvValue).join(","),...rows.map(r=>headers.map(h=>toCsvValue(r[h])).join(","))];const blob=new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url)}
const exportMenuBtn=$("exportMenuBtn"),exportDropdown=$("exportDropdown");exportMenuBtn.onclick=e=>{e.stopPropagation();exportDropdown.classList.toggle("show")};document.addEventListener("click",()=>exportDropdown.classList.remove("show"));
$("exportAllCsv").onclick=()=>downloadCsv(allCompanies,"all-companies.csv");$("exportFilteredCsv").onclick=()=>downloadCsv(filteredCompanies,"filtered-companies.csv");
$("exportDataFile").onclick=()=>{const blob=new Blob([`const COMPANIES = ${JSON.stringify(allCompanies,null,2)};`],{type:"text/javascript"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="companies.js";a.click();URL.revokeObjectURL(url);showToast("Data file downloaded — replace companies.js to keep changes permanently")};

const importBtn=$("importBtn"),importFile=$("importFile");importBtn.onclick=()=>importFile.click();
importFile.addEventListener("change",e=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=evt=>{try{const rows=parseCsv(evt.target.result),mapped=rows.map(mapImportedRow).filter(c=>clean(c["Company Name"]));let added=0,skipped=0;const keys=new Set(allCompanies.map(c=>companyKey(c["Company Name"])).filter(Boolean));mapped.forEach(c=>{const k=companyKey(c["Company Name"]);if(keys.has(k)){skipped++;return}c["#"]=currentUser?.role==="user"?`new-${crypto.randomUUID()}`:nextId++;allCompanies.push(c);keys.add(k);added++});refreshData();showToast(`${added} imported${skipped?`, ${skipped} duplicate(s) skipped`:""}`)}catch(err){console.error(err);showToast("Import failed — check the CSV format")}importFile.value=""};reader.readAsText(file)});
function parseCsv(text){const rows=[];let row=[],cur="",quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cur+='"';i++}else quoted=!quoted}else if(ch===","&&!quoted){row.push(cur);cur=""}else if((ch==="\n"||ch==="\r")&&!quoted){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(cur);if(row.some(v=>v.trim()!==""))rows.push(row);row=[];cur=""}else cur+=ch}row.push(cur);if(row.some(v=>v.trim()!==""))rows.push(row);if(rows.length<2)return[];const headers=rows[0].map(h=>h.trim());return rows.slice(1).map(values=>Object.fromEntries(headers.map((h,i)=>[h,(values[i]??"").trim()]))) }
function mapImportedRow(row){const find=(...names)=>{for(const n of names){const k=Object.keys(row).find(k=>k.trim().toLowerCase()===n.toLowerCase());if(k)return row[k]}return""};return{"Company Name":find("Company Name","Company"),"Unnamed: 2":find("Website","Unnamed: 2"),"Vertical":find("Vertical"),"Manufacturer":normalizeBoolean(find("Manufacturer"))==="yes"?"Yes":"No","Distributor":normalizeBoolean(find("Distributor"))==="yes"?"Yes":"No","Source Buddy":normalizeBoolean(find("Source Buddy"))==="yes"?"Yes":"No","Name":find("POC","POC 1","Contact Name","Main Contact","Name"),"Designation 1":find("Designation","Designation 1"),"Email.1":find("Email","Email.1"),"Number":find("Phone","Phone.","Number","Mobile"),"LinkedIN":find("LinkedIn","LinkedIN")}}

function validEmail(v){return !v||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)}
function validPhone(v){return !v||/^[+\d][\d\s().-]{6,20}$/.test(v)}
function validUrl(v,linkedinOnly=false){if(!v)return true;try{const u=new URL(/^https?:\/\//i.test(v)?v:`https://${v}`);return !linkedinOnly||/(^|\.)linkedin\.com$/i.test(u.hostname)}catch{return false}}
function validateFields({email,phone,site,linked}){if(!validEmail(email)){showToast("Enter a valid email address");return false}if(!validPhone(phone)){showToast("Enter a valid phone number");return false}if(!validUrl(site)){showToast("Enter a valid website URL");return false}if(!validUrl(linked,true)){showToast("Enter a valid LinkedIn URL");return false}return true}
function findDuplicate(name,excludeId=null){const key=companyKey(name);return allCompanies.find(c=>c["#"]!==excludeId&&companyKey(c["Company Name"])===key)}

const addModal=$("addModal"),modalOverlay=$("modalOverlay");$("addCompanyBtn").onclick=openAddModal;$("closeModal").onclick=closeAddModal;$("cancelNewCompany").onclick=closeAddModal;modalOverlay.onclick=closeAddModal;
function openAddModal(){["f_name","f_website","f_vertical","f_pocname","f_designation","f_email","f_phone","f_linkedin"].forEach(id=>$(id).value="");$("f_manufacturer").value=$("f_distributor").value=$("f_sourcebuddy").value="No";addModal.classList.add("open");modalOverlay.classList.add("show")}
function closeAddModal(){addModal.classList.remove("open");modalOverlay.classList.remove("show")}
$("saveNewCompany").onclick=()=>{const name=$("f_name").value.trim(),site=$("f_website").value.trim(),email=$("f_email").value.trim(),phone=$("f_phone").value.trim(),linked=$("f_linkedin").value.trim();if(!name){showToast("Company name is required");return}if(!validateFields({email,phone,site,linked}))return;const dup=findDuplicate(name);if(dup&&!confirm(`A similar company already exists: "${dup["Company Name"]}". Add anyway?`))return;allCompanies.unshift({"#":currentUser?.role==="user"?`new-${crypto.randomUUID()}`:nextId++,"Company Name":name,"Unnamed: 2":site,"Vertical":$("f_vertical").value.trim(),"Manufacturer":$("f_manufacturer").value,"Distributor":$("f_distributor").value,"Source Buddy":$("f_sourcebuddy").value,"Name":$("f_pocname").value.trim(),"Designation 1":$("f_designation").value.trim(),"Email.1":email,"Number":phone,"LinkedIN":linked});refreshData();closeAddModal();showToast("Company added")};

const detailsPanel=$("detailsPanel"),overlay=$("overlay"),panelCompany=$("panelCompany"),panelBody=$("panelBody"),editToggleBtn=$("editToggle"),toast=$("toast");
const FIELD_DEFS=[{group:"Company Information",fields:[{label:"Website",key:"Unnamed: 2",link:true},{label:"Vertical",key:"Vertical"},{label:"Manufacturer",key:"Manufacturer",select:true},{label:"Distributor",key:"Distributor",select:true},{label:"Source Buddy",key:"Source Buddy",select:true}]},{group:"Primary Contact",fields:[{label:"Name",key:"__primaryName"},{label:"Designation",key:"Designation 1"},{label:"Email",key:"__primaryEmail"},{label:"Phone",key:"__primaryPhone"},{label:"LinkedIn",key:"LinkedIN",link:true}]},{group:"Secondary Contact",fields:[{label:"POC",key:"POC 2"},{label:"Designation",key:"Designation 2"},{label:"LinkedIn",key:"LinkedIN.1",link:true}]},{group:"Third Contact",fields:[{label:"POC",key:"POC 3"},{label:"Designation",key:"Designation 3"},{label:"LinkedIn",key:"LinkedIN.2",link:true}]}];
function panelValue(c,key){if(key==="__primaryName")return primaryName(c);if(key==="__primaryEmail")return primaryEmail(c);if(key==="__primaryPhone")return primaryPhone(c);return c[key]??""}
function panelTargetKey(c,key){if(key==="__primaryName")return clean(c["Name"])?"Name":"POC 1";if(key==="__primaryEmail")return clean(c["Email.1"])?"Email.1":"Email";if(key==="__primaryPhone")return clean(c["Number"])?"Number":"Phone.";return key}
function openCompany(c){selectedCompany=c;editMode=false;editToggleBtn.innerHTML='<i class="fa-solid fa-pen"></i> Edit';renderPanel();detailsPanel.classList.add("open");overlay.classList.add("show")}
function renderPanel(){panelCompany.textContent=selectedCompany["Company Name"]||"";let html="";FIELD_DEFS.forEach(section=>{html+=`<div class="info-card"><h3>${section.group}</h3>`;section.fields.forEach(f=>{const val=panelValue(selectedCompany,f.key),target=panelTargetKey(selectedCompany,f.key);if(editMode){html+=f.select?`<div class="info-row"><span>${f.label}</span><select data-field="${target}" style="width:120px"><option value="No" ${normalizeBoolean(val)==="no"?"selected":""}>No</option><option value="Yes" ${normalizeBoolean(val)==="yes"?"selected":""}>Yes</option></select></div>`:`<div class="info-row"><span>${f.label}</span><input data-field="${target}" value="${escapeHtml(val)}"></div>`}else{html+=`<div class="info-row"><span>${f.label}</span><span>${f.link?websiteLink(val):(escapeHtml(val)||"-")}</span></div>`}});html+="</div>"});panelBody.innerHTML=html}
editToggleBtn.onclick=()=>{if(editMode){const pending={};panelBody.querySelectorAll("[data-field]").forEach(el=>pending[el.dataset.field]=el.value.trim());const email=pending["Email.1"]??pending["Email"]??primaryEmail(selectedCompany),phone=pending["Number"]??pending["Phone."]??primaryPhone(selectedCompany),site=pending["Unnamed: 2"]??website(selectedCompany),linked=pending["LinkedIN"]??linkedin(selectedCompany);if(!validateFields({email,phone,site,linked}))return;Object.assign(selectedCompany,pending);editMode=false;editToggleBtn.innerHTML='<i class="fa-solid fa-pen"></i> Edit';refreshData();showToast("Changes saved")}else{editMode=true;editToggleBtn.innerHTML='<i class="fa-solid fa-check"></i> Save'}renderPanel()};
$("closePanel").onclick=closeDetails;overlay.onclick=closeDetails;function closeDetails(){detailsPanel.classList.remove("open");overlay.classList.remove("show");editMode=false}
$("copyEmail").onclick=()=>{const v=selectedCompany?primaryEmail(selectedCompany):"";if(!v){showToast("No email available");return}navigator.clipboard.writeText(v);showToast("Email copied")};
$("copyPhone").onclick=()=>{const v=selectedCompany?primaryPhone(selectedCompany):"";if(!v){showToast("No phone available");return}navigator.clipboard.writeText(v);showToast("Phone copied")};
$("exportCompany").onclick=()=>selectedCompany&&downloadCsv([selectedCompany],`${selectedCompany["Company Name"]||"company"}.csv`);
$("deleteCompany").onclick=()=>{if(!requireAdmin()||!selectedCompany||!confirm(`Delete "${selectedCompany["Company Name"]}"? This cannot be undone.`))return;const id=selectedCompany["#"];allCompanies=allCompanies.filter(c=>c["#"]!==id);selectedIds.delete(id);closeDetails();refreshData();updateBulkBar();showToast("Company deleted")};

// ================= MAIL OUTREACH WORKFLOW =================
const mailModal=$("mailModal"),mailOverlay=$("mailOverlay"),mailContext=$("mailContext"),mailTemplateType=$("mailTemplateType"),mailTo=$("mailTo"),mailSubject=$("mailSubject"),mailBody=$("mailBody");
function openMailPreview(c,queue=null,index=-1){
    if(!primaryEmail(c)){showToast("No email available for this company");return}
    const templateType=templateTypeFor(c);
    if(!templateType){showToast("Set exactly one of Manufacturer or Distributor to Yes before mailing");return}
    mailingCompany=c;
    if(queue){mailingQueue=queue;mailingQueueIndex=index}
    const m=normalizeBoolean(c["Manufacturer"])==="yes",d=normalizeBoolean(c["Distributor"])==="yes";
    $("senderDisplay").textContent=approvedSender?`FROM CHECK: ${approvedSender}`:"Sender not configured — set it in Mail Templates";
    mailContext.innerHTML=`<strong>${escapeHtml(c["Company Name"])}</strong><span>${m?"MANUFACTURER":""}${m&&d?" + ":""}${d?"DISTRIBUTOR":""}</span><span>${escapeHtml(primaryName(c)||"CONTACT NAME MISSING")}</span><span>${mailStatus(c)==="sent"?"ALREADY SENT":"NOT SENT"}</span>`;
    mailTemplateType.value=templateType;
    renderPreparedTemplate();
    mailModal.classList.add("open");mailOverlay.classList.add("show");
}
function renderPreparedTemplate(){
    if(!mailingCompany)return;
    const templateType=templateTypeFor(mailingCompany);
    const t=mailTemplates[templateType]||DEFAULT_TEMPLATES[templateType];
    mailTemplateType.value=templateType;
    mailTo.value=primaryEmail(mailingCompany);
    mailSubject.value=fillTemplate(t.subject,mailingCompany);
    mailBody.value=fillTemplate(t.body,mailingCompany);
}
function closeMailPreview(){mailModal.classList.remove("open");mailOverlay.classList.remove("show")}
$("closeMailModal").onclick=closeMailPreview;mailOverlay.onclick=closeMailPreview;
$("mailCompany").onclick=()=>selectedCompany&&openMailPreview(selectedCompany);
$("copyPreparedMail").onclick=async()=>{await navigator.clipboard.writeText(`Subject: ${mailSubject.value}\n\n${mailBody.value}`);showToast("Prepared message copied")};
$("openMailComposer").onclick=()=>{
    if(!validEmail(mailTo.value.trim())){showToast("Check the recipient email");return}
    if(!approvedSender){showToast("Set the approved company sender in Mail Templates first");return}
    const url=`mailto:${encodeURIComponent(mailTo.value.trim())}?cc=${encodeURIComponent("suhaas.sastry@idamtat.in")}&subject=${encodeURIComponent(mailSubject.value)}&body=${encodeURIComponent(mailBody.value)}`;
    window.location.href=url;
};

$("markNotSent").onclick=()=>{
    if(!mailingCompany)return;
    delete mailState[String(mailingCompany["#"])];
    saveMailState();renderTable();
    mailContext.querySelector("span:last-child").textContent="NOT SENT";
    showToast("Marked as not sent");
};

$("markSentNext").onclick=()=>{
    if(!mailingCompany)return;
    mailState[String(mailingCompany["#"])]={status:"sent",sentAt:new Date().toISOString()};
    saveMailState();showToast("Marked as sent");renderTable();
    if(mailingQueue.length){
        let next=mailingQueueIndex+1;
        while(next<mailingQueue.length&&mailStatus(mailingQueue[next])==="sent")next++;
        if(next<mailingQueue.length){mailingQueueIndex=next;openMailPreview(mailingQueue[next],mailingQueue,next);return}
        showToast("Mailing queue completed");
    }
    closeMailPreview();
};
$("startMailingBtn").onclick=()=>{
    const queue=filteredCompanies.filter(isReadyToMail);
    if(!queue.length){showToast("No ready-to-mail companies in the current view");return}
    mailingQueue=queue;mailingQueueIndex=0;openMailPreview(queue[0],queue,0);
};

// Template manager
const templateModal=$("templateModal"),templateOverlay=$("templateOverlay"),templateSubject=$("templateSubject"),templateBody=$("templateBody"),senderEmail=$("senderEmail");
let editingTemplate="manufacturer";
function loadTemplateEditor(type){
    editingTemplate=type;
    document.querySelectorAll(".template-tab").forEach(b=>b.classList.toggle("active",b.dataset.templateTab===type));
    const t=mailTemplates[type]||DEFAULT_TEMPLATES[type];templateSubject.value=t.subject;templateBody.value=t.body;
}
$("templateManagerBtn").onclick=()=>{senderEmail.value=approvedSender;loadTemplateEditor("manufacturer");templateModal.classList.add("open");templateOverlay.classList.add("show")};
function closeTemplateManager(){templateModal.classList.remove("open");templateOverlay.classList.remove("show")}
$("closeTemplateModal").onclick=closeTemplateManager;templateOverlay.onclick=closeTemplateManager;
document.querySelectorAll(".template-tab").forEach(b=>b.onclick=()=>loadTemplateEditor(b.dataset.templateTab));
$("saveTemplate").onclick=()=>{
    const sender=senderEmail.value.trim();
    if(sender&&!validEmail(sender)){showToast("Enter a valid approved sender email");return}
    approvedSender=sender;localStorage.setItem(MAIL_SENDER_KEY,approvedSender);
    mailTemplates[editingTemplate]={subject:templateSubject.value,body:templateBody.value};
    saveMailTemplates();showToast(`${editingTemplate==="manufacturer"?"Manufacturer":"Distributor"} template and sender setting saved`);
};

document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeDetails();closeAddModal();closeMailPreview();closeTemplateManager()}});
function showToast(message){toast.textContent=message;toast.classList.add("show");clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.classList.remove("show"),2500)}
function refreshData(){saveCompanies();calculateKPIs();populateVerticalFilter();applyFilters()}

async function initializeApplication(){
    try{
        const me=await fetch("/api/me");
        if(!me.ok){location.replace("login-new.html");return}
        currentUser=(await me.json()).user;
        $("currentUserLabel").textContent=`${currentUser.name} // ${currentUser.role.toUpperCase()}`;
        document.querySelectorAll("[data-admin-only]").forEach(el=>el.hidden=currentUser.role!=="admin");
        const data=await fetch("/api/companies");
        if(!data.ok)throw Error("Unable to load authorized companies");
        allCompanies=(await data.json()).companies;
        nextId=Math.max(0,...allCompanies.map(c=>Number(c["#"])||0))+1;
        calculateKPIs();populateVerticalFilter();applyFilters();
    }catch(err){console.error(err);location.replace("login-new.html")}
}
$("logoutBtn").onclick=async()=>{await fetch("/api/logout",{method:"POST"});location.replace("login-new.html")};
initializeApplication();
