// Book table and reference parser. Accepts Indonesian (TB) and English names/abbreviations:
//   "Yoh 3:16", "Yohanes 3:16-18", "John 3.16", "1 Kor 13:4-7", "Mzm 23", "Kej 1:1-2:3", "II Tim 3:16"
// Each row: [English (ESV query name), Indonesian (TB name), extra aliases...]
export const BOOKS = [
  ["Genesis","Kejadian","kej","gen","gn"],
  ["Exodus","Keluaran","kel","exo","ex"],
  ["Leviticus","Imamat","im","lev","lv"],
  ["Numbers","Bilangan","bil","num","nm"],
  ["Deuteronomy","Ulangan","ul","ula","deut","dt"],
  ["Joshua","Yosua","yos","josh","jos"],
  ["Judges","Hakim-hakim","hak","hakim","judg","jdg"],
  ["Ruth","Rut","rut","ru"],
  ["1 Samuel","1 Samuel","1sam","1sa","1sm"],
  ["2 Samuel","2 Samuel","2sam","2sa","2sm"],
  ["1 Kings","1 Raja-raja","1raj","1raja","1kgs","1ki","1kin"],
  ["2 Kings","2 Raja-raja","2raj","2raja","2kgs","2ki","2kin"],
  ["1 Chronicles","1 Tawarikh","1taw","1chr","1ch"],
  ["2 Chronicles","2 Tawarikh","2taw","2chr","2ch"],
  ["Ezra","Ezra","ezr"],
  ["Nehemiah","Nehemia","neh"],
  ["Esther","Ester","est","esth"],
  ["Job","Ayub","ayb","ayub","job","jb"],
  ["Psalms","Mazmur","mzm","maz","ps","psa","psalm","pss"],
  ["Proverbs","Amsal","ams","prov","pr","prv"],
  ["Ecclesiastes","Pengkhotbah","pkh","eccl","ecc","qoh"],
  ["Song of Solomon","Kidung Agung","kid","kidung","song","sos","sng","songofsongs","canticles"],
  ["Isaiah","Yesaya","yes","isa","is"],
  ["Jeremiah","Yeremia","yer","jer"],
  ["Lamentations","Ratapan","rat","lam"],
  ["Ezekiel","Yehezkiel","yeh","ezek","eze","ezk"],
  ["Daniel","Daniel","dan","dn"],
  ["Hosea","Hosea","hos"],
  ["Joel","Yoel","yl","yoel","joel","jl"],
  ["Amos","Amos","am","amo"],
  ["Obadiah","Obaja","ob","oba","obad"],
  ["Jonah","Yunus","yun","jonah","jon"],
  ["Micah","Mikha","mi","mik","mic"],
  ["Nahum","Nahum","nah","na"],
  ["Habakkuk","Habakuk","hab"],
  ["Zephaniah","Zefanya","zef","zeph","zep"],
  ["Haggai","Hagai","hag","hg"],
  ["Zechariah","Zakharia","za","zak","zech","zec"],
  ["Malachi","Maleakhi","mal"],
  ["Matthew","Matius","mat","mt","matt"],
  ["Mark","Markus","mrk","mark","mk","mr"],
  ["Luke","Lukas","luk","luke","lk"],
  ["John","Yohanes","yoh","john","jn","jhn"],
  ["Acts","Kisah Para Rasul","kis","kisah","acts","act","ac"],
  ["Romans","Roma","rm","rom","ro"],
  ["1 Corinthians","1 Korintus","1kor","1cor","1co"],
  ["2 Corinthians","2 Korintus","2kor","2cor","2co"],
  ["Galatians","Galatia","gal","ga"],
  ["Ephesians","Efesus","ef","efe","eph"],
  ["Philippians","Filipi","flp","fil","phil","php"],
  ["Colossians","Kolose","kol","col"],
  ["1 Thessalonians","1 Tesalonika","1tes","1thess","1th"],
  ["2 Thessalonians","2 Tesalonika","2tes","2thess","2th"],
  ["1 Timothy","1 Timotius","1tim","1ti"],
  ["2 Timothy","2 Timotius","2tim","2ti"],
  ["Titus","Titus","tit"],
  ["Philemon","Filemon","flm","filemon","phlm","phm"],
  ["Hebrews","Ibrani","ibr","heb"],
  ["James","Yakobus","yak","jas","jam","jms"],
  ["1 Peter","1 Petrus","1ptr","1pet","1pe","1pt"],
  ["2 Peter","2 Petrus","2ptr","2pet","2pe","2pt"],
  ["1 John","1 Yohanes","1yoh","1jn","1john","1jo"],
  ["2 John","2 Yohanes","2yoh","2jn","2john","2jo"],
  ["3 John","3 Yohanes","3yoh","3jn","3john","3jo"],
  ["Jude","Yudas","yud","jude","jud"],
  ["Revelation","Wahyu","why","wahyu","rev","re","revelations"],
];

const norm = s => s.toLowerCase()
  .replace(/^(iii|ii|i)(?=[\s.])\s*\.?\s*/, m => ({i:"1",ii:"2",iii:"3"})[m.replace(/[\s.]/g,"")] + " ")
  .replace(/[\s.\-]/g, "");

// Build exact-alias map, plus the list of full names for prefix matching.
const EXACT = new Map(), NAMES = [];
BOOKS.forEach((row, i) => {
  row.forEach(n => EXACT.set(norm(n), i));
  NAMES.push([norm(row[0]), i], [norm(row[1]), i]);
});

export function findBook(name){
  const n = norm(name);
  if (!n) return -1;
  if (EXACT.has(n)) return EXACT.get(n);
  const hit = NAMES.filter(([full]) => full.startsWith(n)).map(([, i]) => i);
  return hit.length ? Math.min(...hit) : -1;   // ambiguous prefix → canonical order
}

// Returns {book, c1, v1, c2, v2} (v1/v2 null = whole chapter) or throws Error with a readable message.
export function parseRef(input){
  const s = input.trim().replace(/[–—]/g, "-").replace(/\s+/g, " ");
  const m = s.match(/^((?:[1-3]|i{1,3})?\s*\.?\s*[a-z][a-z\s\-.]*?)\s*(\d+)(?:\s*[:.]\s*(\d+))?(?:\s*-\s*(\d+)(?:\s*[:.]\s*(\d+))?)?\s*$/i);
  if (!m) throw new Error(`Can't read "${input}". Try "Yoh 3:16" or "John 3:16-18".`);
  const book = findBook(m[1]);
  if (book < 0) throw new Error(`Unknown book "${m[1].trim()}".`);
  const c1 = +m[2], v1 = m[3] ? +m[3] : null;
  let c2 = c1, v2 = v1;
  if (m[4]){
    if (m[5]) { c2 = +m[4]; v2 = +m[5]; }          // 3:16-4:2
    else if (v1 != null) v2 = +m[4];               // 3:16-18
    else { c2 = +m[4]; v2 = null; }                // 3-4 (chapters)
  }
  if (c2 < c1 || (c2 === c1 && v1 != null && v2 < v1)) throw new Error("The range ends before it starts.");
  return { book, c1, v1, c2, v2 };
}

// "Yohanes 3:16-18" / "John 3:16–18"
export function formatRef(r, lang = "en"){
  const name = BOOKS[r.book][lang === "id" ? 1 : 0];
  let out = `${name} ${r.c1}`;
  if (r.v1 != null) out += `:${r.v1}`;
  if (r.c2 !== r.c1) out += r.v2 != null ? `-${r.c2}:${r.v2}` : `-${r.c2}`;
  else if (r.v2 != null && r.v2 !== r.v1) out += `-${r.v2}`;
  return out;
}
