/**
 * Comistream Directory Listing JavaScript
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024-2025 Comistream Project.
 * @license     GPL3.0 License
 * @version     1.2.0
 * @link        https://github.com/sorshi/comistream-reader
 */

// Global variables and constants
const iconPath = "/theme/icons/";
let previewWindowHeight = Math.round(
  (812 * document.documentElement.clientWidth) / 1734
); // プレビュー画像の表示上の高さ

// ソート設定の管理
let currentSortBy = 'name';
let currentSortOrder = 'asc';
let currentPath = window.location.pathname;

// Intl.Collator for natural sorting with kana normalization
// macOSのFinderと同じような濁点・半濁点順序のため sensitivity を 'accent' に変更
const collator = new Intl.Collator('ja', {
  numeric: true,
  sensitivity: 'accent', // 濁点・半濁点を区別するためbaseからaccentに変更
  ignorePunctuation: true,
  caseFirst: 'upper'
});

// カタカナをひらがなに変換するマッピング
const katakanaToHiragana = {
  'ア': 'あ', 'イ': 'い', 'ウ': 'う', 'エ': 'え', 'オ': 'お',
  'カ': 'か', 'キ': 'き', 'ク': 'く', 'ケ': 'け', 'コ': 'こ',
  'サ': 'さ', 'シ': 'し', 'ス': 'す', 'セ': 'せ', 'ソ': 'そ',
  'タ': 'た', 'チ': 'ち', 'ツ': 'つ', 'テ': 'て', 'ト': 'と',
  'ナ': 'な', 'ニ': 'に', 'ヌ': 'ぬ', 'ネ': 'ね', 'ノ': 'の',
  'ハ': 'は', 'ヒ': 'ひ', 'フ': 'ふ', 'ヘ': 'へ', 'ホ': 'ほ',
  'マ': 'ま', 'ミ': 'み', 'ム': 'む', 'メ': 'め', 'モ': 'も',
  'ヤ': 'や', 'ユ': 'ゆ', 'ヨ': 'よ',
  'ラ': 'ら', 'リ': 'り', 'ル': 'る', 'レ': 'れ', 'ロ': 'ろ',
  'ワ': 'わ', 'ヲ': 'を', 'ン': 'ん',
  'ガ': 'が', 'ギ': 'ぎ', 'グ': 'ぐ', 'ゲ': 'げ', 'ゴ': 'ご',
  'ザ': 'ざ', 'ジ': 'じ', 'ズ': 'ず', 'ゼ': 'ぜ', 'ゾ': 'ぞ',
  'ダ': 'だ', 'ヂ': 'ぢ', 'ヅ': 'づ', 'デ': 'で', 'ド': 'ど',
  'バ': 'ば', 'ビ': 'び', 'ブ': 'ぶ', 'ベ': 'べ', 'ボ': 'ぼ',
  'パ': 'ぱ', 'ピ': 'ぴ', 'プ': 'ぷ', 'ペ': 'ぺ', 'ポ': 'ぽ',
  'ャ': 'ゃ', 'ュ': 'ゅ', 'ョ': 'ょ', 'ッ': 'っ', 'ー': 'ー'
};

// 半角カタカナを全角カタカナに変換するマッピング
const hankakuToZenkaku = {
  'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ', 'ｵ': 'オ',
  'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ', 'ｺ': 'コ',
  'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ', 'ｿ': 'ソ',
  'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ', 'ﾄ': 'ト',
  'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ',
  'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ', 'ﾎ': 'ホ',
  'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ',
  'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ',
  'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ',
  'ﾜ': 'ワ', 'ｦ': 'ヲ', 'ﾝ': 'ン',
  'ｶﾞ': 'ガ', 'ｷﾞ': 'ギ', 'ｸﾞ': 'グ', 'ｹﾞ': 'ゲ', 'ｺﾞ': 'ゴ',
  'ｻﾞ': 'ザ', 'ｼﾞ': 'ジ', 'ｽﾞ': 'ズ', 'ｾﾞ': 'ゼ', 'ｿﾞ': 'ゾ',
  'ﾀﾞ': 'ダ', 'ﾁﾞ': 'ヂ', 'ﾂﾞ': 'ヅ', 'ﾃﾞ': 'デ', 'ﾄﾞ': 'ド',
  'ﾊﾞ': 'バ', 'ﾋﾞ': 'ビ', 'ﾌﾞ': 'ブ', 'ﾍﾞ': 'ベ', 'ﾎﾞ': 'ボ',
  'ﾊﾟ': 'パ', 'ﾋﾟ': 'ピ', 'ﾌﾟ': 'プ', 'ﾍﾟ': 'ペ', 'ﾎﾟ': 'ポ',
  'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ', 'ｯ': 'ッ'
};

// 全角アルファベットを半角に変換するマッピング
const zenkakuAlphaToHankaku = {
  'Ａ': 'A', 'Ｂ': 'B', 'Ｃ': 'C', 'Ｄ': 'D', 'Ｅ': 'E',
  'Ｆ': 'F', 'Ｇ': 'G', 'Ｈ': 'H', 'Ｉ': 'I', 'Ｊ': 'J',
  'Ｋ': 'K', 'Ｌ': 'L', 'Ｍ': 'M', 'Ｎ': 'N', 'Ｏ': 'O',
  'Ｐ': 'P', 'Ｑ': 'Q', 'Ｒ': 'R', 'Ｓ': 'S', 'Ｔ': 'T',
  'Ｕ': 'U', 'Ｖ': 'V', 'Ｗ': 'W', 'Ｘ': 'X', 'Ｙ': 'Y', 'Ｚ': 'Z',
  'ａ': 'a', 'ｂ': 'b', 'ｃ': 'c', 'ｄ': 'd', 'ｅ': 'e',
  'ｆ': 'f', 'ｇ': 'g', 'ｈ': 'h', 'ｉ': 'i', 'ｊ': 'j',
  'ｋ': 'k', 'ｌ': 'l', 'ｍ': 'm', 'ｎ': 'n', 'ｏ': 'o',
  'ｐ': 'p', 'ｑ': 'q', 'ｒ': 'r', 'ｓ': 's', 'ｔ': 't',
  'ｕ': 'u', 'ｖ': 'v', 'ｗ': 'w', 'ｘ': 'x', 'ｙ': 'y', 'ｚ': 'z'
};

// 全角数字を半角に変換するマッピング
const zenkakuNumToHankaku = {
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9'
};

// 全角スペースを半角に変換
const zenkakuSpaceToHankaku = { '　': ' ' };

// カタカナをひらがなに変換する関数
function convertKatakanaToHiragana(str) {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (katakanaToHiragana[char]) {
      result += katakanaToHiragana[char];
    } else {
      result += char;
    }
  }
  return result;
}

// 半角カタカナを全角カタカナに変換する関数
function convertHankakuKanaToZenkaku(str) {
  let result = '';
  let i = 0;
  while (i < str.length) {
    const char = str[i];
    const nextChar = str[i + 1];
    // 濁点・半濁点付きの半角カナをチェック
    if (nextChar === 'ﾞ' || nextChar === 'ﾟ') {
      const combined = char + nextChar;
      if (hankakuToZenkaku[combined]) {
        result += hankakuToZenkaku[combined];
        i += 2;
        continue;
      }
    }
    // 通常の半角カナ
    if (hankakuToZenkaku[char]) {
      result += hankakuToZenkaku[char];
    } else {
      result += char;
    }
    i++;
  }
  return result;
}

// 半角全角変換関数
function convertWidth(str) {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (zenkakuAlphaToHankaku[char]) {
      result += zenkakuAlphaToHankaku[char];
    } else if (zenkakuNumToHankaku[char]) {
      result += zenkakuNumToHankaku[char];
    } else if (zenkakuSpaceToHankaku[char]) {
      result += zenkakuSpaceToHankaku[char];
    } else {
      result += char;
    }
  }
  return result;
}

// 濁点・半濁点の順序を制御するためのマッピング
const dakutenOrder = {
  // ハ行
  'は': '1', 'ば': '2', 'ぱ': '3',
  'ひ': '1', 'び': '2', 'ぴ': '3',
  'ふ': '1', 'ぶ': '2', 'ぷ': '3',
  'へ': '1', 'べ': '2', 'ぺ': '3',
  'ほ': '1', 'ぼ': '2', 'ぽ': '3',
  // カ行
  'か': '1', 'が': '2',
  'き': '1', 'ぎ': '2',
  'く': '1', 'ぐ': '2',
  'け': '1', 'げ': '2',
  'こ': '1', 'ご': '2',
  // サ行
  'さ': '1', 'ざ': '2',
  'し': '1', 'じ': '2',
  'す': '1', 'ず': '2',
  'せ': '1', 'ぜ': '2',
  'そ': '1', 'ぞ': '2',
  // タ行
  'た': '1', 'だ': '2',
  'ち': '1', 'ぢ': '2',
  'つ': '1', 'づ': '2',
  'て': '1', 'で': '2',
  'と': '1', 'ど': '2'
};

// JavaScript版のnormalize_kana_for_sort関数
function normalizeKanaForSort(str) {
  if (!str || str === '') {
    return str;
  }

  try {
    // 1. 小文字化
    let normalized = str.toLowerCase();

    // 2. 半角カタカナを全角カタカナに変換
    normalized = convertHankakuKanaToZenkaku(normalized);

    // 3. カタカナをひらがなに変換
    normalized = convertKatakanaToHiragana(normalized);

    // 4. 全角アルファベット・数字・スペースを半角に変換
    normalized = convertWidth(normalized);

    return normalized;
  } catch (e) {
    console.warn('normalizeKanaForSort error:', e);
    return str.toLowerCase();
  }
}

// 濁点・半濁点を考慮したカスタム比較関数
function compareWithDakuten(strA, strB) {
  // 最初にIntl.Collatorで基本比較
  const basicCompare = collator.compare(strA, strB);
  
  // 基本比較で同じ場合のみ、濁点・半濁点の詳細比較を行う
  if (basicCompare !== 0) {
    return basicCompare;
  }
  
  // 文字単位で濁点・半濁点の順序を比較
  const minLength = Math.min(strA.length, strB.length);
  for (let i = 0; i < minLength; i++) {
    const charA = strA[i];
    const charB = strB[i];
    
    if (charA !== charB) {
      const orderA = dakutenOrder[charA] || '1';
      const orderB = dakutenOrder[charB] || '1';
      
      if (orderA !== orderB) {
        return orderA.localeCompare(orderB);
      }
    }
  }
  
  // 長さで最終比較
  return strA.length - strB.length;
}

// クライアント側ソート関数
function sortItemsClientSide(items, sortBy, sortOrder) {
  if (!Array.isArray(items)) {
    return items;
  }

  return items.sort((a, b) => {
    // Parent Directoryは常に先頭
    if (a.is_parent && !b.is_parent) return -1;
    if (!a.is_parent && b.is_parent) return 1;
    if (a.is_parent && b.is_parent) return 0;

    let valA, valB;

    // ソート対象の値を取得
    switch (sortBy) {
      case 'name':
        valA = normalizeKanaForSort(a.name || '');
        valB = normalizeKanaForSort(b.name || '');
        break;
      case 'lastmod':
        valA = a.lastmod || 0;
        valB = b.lastmod || 0;
        break;
      case 'size':
        valA = a.size || 0;
        valB = b.size || 0;
        break;
      default:
        valA = normalizeKanaForSort(a.name || '');
        valB = normalizeKanaForSort(b.name || '');
    }

    // 比較
    let cmp;
    if (sortBy === 'name') {
      cmp = compareWithDakuten(valA, valB);
    } else {
      cmp = valA < valB ? -1 : valA > valB ? 1 : 0;
    }

    // 昇順/降順
    return sortOrder === 'asc' ? cmp : -cmp;
  });
}

// ソート設定をlocalStorageから読み込み
function loadSortSettings() {
  try {
    const sortPrefs = JSON.parse(localStorage.getItem('dirSortPrefs') || '{}');
    const currentPrefs = sortPrefs[currentPath];
    if (currentPrefs) {
      currentSortBy = currentPrefs.sort || 'name';
      currentSortOrder = currentPrefs.order || 'asc';
      debugLog('Loaded sort settings from localStorage:', currentSortBy, currentSortOrder);
    } else {
      debugLog('No sort settings found in localStorage for current path');
    }
  } catch (e) {
    console.warn('Failed to load sort settings from localStorage:', e);
    // デフォルト値を設定
    currentSortBy = 'name';
    currentSortOrder = 'asc';
  }
}

// ソート設定をURLパラメータから読み込み（優先度高）
function loadSortFromUrl() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const sort = urlParams.get('sort');
    const order = urlParams.get('order');

    if (sort && ['name', 'lastmod', 'size'].includes(sort) &&
        order && ['asc', 'desc'].includes(order)) {
      changeSort(sort, order);
      debugLog('Loaded sort settings from URL:', sort, order);
      return true;
    }
  } catch (e) {
    console.warn('Failed to load sort settings from URL:', e);
  }
  return false;
}

// ソート設定をlocalStorageに保存
function saveSortSettings() {
  try {
    const sortPrefs = JSON.parse(localStorage.getItem('dirSortPrefs') || '{}');
    sortPrefs[currentPath] = {
      sort: currentSortBy,
      order: currentSortOrder
    };
    localStorage.setItem('dirSortPrefs', JSON.stringify(sortPrefs));
  } catch (e) {
    console.warn('Failed to save sort settings:', e);
  }
}

// ソート設定を変更
function changeSort(sortBy, sortOrder) {
  currentSortBy = sortBy || 'name';
  currentSortOrder = sortOrder || 'asc';
  saveSortSettings();
}

// ソート設定を適用してアイテムをソート
function applyCurrentSort(items) {
  return sortItemsClientSide(items, currentSortBy, currentSortOrder);
}

// ディレクトリとファイルを別々にソートしてから結合する関数
function sortItemsWithSeparateDirsAndFiles(items, sortBy, sortOrder) {
  if (!Array.isArray(items)) {
    return items;
  }

  const startTime = performance.now();

  // Parent Directory、ディレクトリ、ファイルを分離
  const parentItems = items.filter(item => item.is_parent);
  const dirItems = items.filter(item => item.is_dir && !item.is_parent);
  const fileItems = items.filter(item => !item.is_dir && !item.is_parent);

  debugLog(`DEBUG sortItemsWithSeparateDirsAndFiles: ${items.length} items (${parentItems.length} parent, ${dirItems.length} dirs, ${fileItems.length} files)`);

  // 各グループをソート
  const sortFunc = (a, b) => {
    let valA, valB;

    // ソート対象の値を取得
    switch (sortBy) {
      case 'name':
        valA = normalizeKanaForSort(a.name || '');
        valB = normalizeKanaForSort(b.name || '');
        break;
      case 'lastmod':
        valA = a.lastmod || 0;
        valB = b.lastmod || 0;
        break;
      case 'size':
        valA = a.size || 0;
        valB = b.size || 0;
        break;
      default:
        valA = normalizeKanaForSort(a.name || '');
        valB = normalizeKanaForSort(b.name || '');
    }

    // 比較
    let cmp;
    if (sortBy === 'name') {
      cmp = compareWithDakuten(valA, valB);
    } else {
      cmp = valA < valB ? -1 : valA > valB ? 1 : 0;
    }

    // 昇順/降順
    return sortOrder === 'asc' ? cmp : -cmp;
  };

  // ソート実行
  parentItems.sort(sortFunc);
  dirItems.sort(sortFunc);
  fileItems.sort(sortFunc);

  // 結合して返す
  const result = [...parentItems, ...dirItems, ...fileItems];

  const endTime = performance.now();
  debugLog(`DEBUG sortItemsWithSeparateDirsAndFiles: completed in ${(endTime - startTime).toFixed(2)}ms`);

  return result;
}

// DOM elements
const modal = document.querySelector("#modal");
const modalImage = document.querySelector("#modal-image");
const colname = document.getElementsByClassName("indexcolname");

// data-filepath属性から正確なファイルパスを取得するヘルパー関数（パーセントエンコーディング対応）
function getCleanFilePath(element) {
  var dataFilepath = element.getAttribute("data-filepath");
  var hrefFilepath = element.getAttribute("href");
  var rawFilepath = dataFilepath || hrefFilepath;

  // パーセントエンコーディングをデコード
  if (rawFilepath) {
    try {
      rawFilepath = decodeURIComponent(rawFilepath);
    } catch (e) {
      // デコードに失敗した場合はそのまま使用
      console.warn("Failed to decode filepath:", rawFilepath, e);
    }
  }

  // パスの先頭の/を除去
  if (!rawFilepath) return "";

  // basic normalisation / sanitisation
  rawFilepath = rawFilepath.replace(/\0/g, ""); // NUL byte
  rawFilepath = rawFilepath.replace(/^\//, ""); // leading slash
  // prevent "…/../" traversal
  while (rawFilepath.startsWith("../")) rawFilepath = rawFilepath.substring(3);

  return rawFilepath;
}

// Load long-press event script
function loadLongPressScript() {
  var script = document.createElement("script");
  script.src = "/theme/js/long-press-event.min.js";
  document.body.appendChild(script);
}

// Long press event handler
function setupLongPressHandler() {
  window.addEventListener("long-press", function (e) {
    // stop the event from bubbling up
    e.preventDefault();
    // 作りかけの書籍情報開くメニュー
    //openBookDetailMenu(e);
    // ファイル操作メニュー(プレビュー画像と表紙画像の一旦削除)
    openFileMenu(e);
  });
}

function openFileMenu(e) {
  // リストビューでtdからクリックされた場合は内部のaタグを探す
  var targetElement = e.target;
  if (targetElement.tagName === 'TD' && targetElement.classList.contains('indexcolname')) {
    var anchorElement = targetElement.querySelector('a');
    if (anchorElement) {
      targetElement = anchorElement;
    }
  }

  // data-filepath属性から正確なファイルパスを取得（#文字対応）
  var fileLink = getCleanFilePath(targetElement);

  // URLパラメータ用にエンコード
  fileLink = encodeURIComponent(fileLink)
    .replaceAll("&", "%26")
    .replaceAll("=", "%3D");

  document.getElementById("newname").value = targetElement.innerText;
  document.getElementById("orgname").value = targetElement.innerText;
  document.getElementById("fileLink").value = fileLink;
  document.getElementById("filemenu").style.display = "block";
  document.getElementById("filemenu").style.top = e.pageY + "px";
}

function openBookDetailMenu(e) {
  // リストビューでtdからクリックされた場合は内部のaタグを探す
  var targetElement = e.target;
  if (targetElement.tagName === 'TD' && targetElement.classList.contains('indexcolname')) {
    var anchorElement = targetElement.querySelector('a');
    if (anchorElement) {
      targetElement = anchorElement;
    }
  }

  // data-filepath属性から正確なファイルパスを取得（#文字対応）
  var fileLink = getCleanFilePath(targetElement);

  // URLパラメータ用にエンコード
  fileLink = encodeURIComponent(fileLink)
    .replaceAll("&", "%26")
    .replaceAll("=", "%3D");

  document.getElementById("fileA").value = targetElement.innerText;
  document.getElementById("fileB").value = targetElement.innerText;
  document.getElementById("detailFileLink").value = fileLink;
  document.getElementById("bookdetail").style.display = "block";
  document.getElementById("bookdetail").style.top = e.pageY + "px";
}

function linkhook(e) {
  // リストビューでtdからクリックされた場合は内部のaタグを探す
  var targetElement = e.target;
  if (targetElement.tagName === 'TD' && targetElement.classList.contains('indexcolname')) {
    var anchorElement = targetElement.querySelector('a');
    if (anchorElement) {
      targetElement = anchorElement;
    }
  }

  // data-filepath属性から正確なファイルパスを取得（#文字対応）
  var fileLink = getCleanFilePath(targetElement);

  // URLパラメータ用にエンコード
  fileLink = encodeURIComponent(fileLink)
    .replaceAll("&", "%26")
    .replaceAll("=", "%3D");
  // console.log("linkhook()"+fileLink);

  // altキー押下時はファイル操作メニューを開く
  if (e.altKey == true) {
    e.preventDefault();
    openFileMenu(e);
    return false;
  }

  // 画像ファイルはそのままブラウザで開く（リーダーは起動しない）
  if (
    targetElement.href &&
    targetElement.href.match(/\.(jpe?g|png|gif|webp|avif|bmp|svg|tiff?|heic|heif)$/i)
  ) {
    return true; // onclick="return linkhook(event)" のため true でデフォルト遷移
  }

  // 音楽ファイルの場合
  if (
    targetElement.href &&
    targetElement.href.match(/\.(mp3|m4a|aac|flac|aiff|aif|wav|wave|ogg|oga|wma)$/i)
  ) {
    e.preventDefault();
    // 音楽プレイヤーを開く
    var musicPlayerHref =
      "/cgi-bin/music_player.php?file=" + fileLink + "&mode=open";
    document.getElementById("history").innerHTML =
      '<a class="history_music" href=' +
      location.origin +
      musicPlayerHref +
      ">" +
      targetElement.innerText +
      "</a>";
    location.href = musicPlayerHref;
    return false;
  }

  // ファイル種別に応じた処理を追加
  if (
    targetElement.href &&
    targetElement.href.match(/\.(m2t|ts|iso|mp4|m4v|avi|mkv|wmv|mpg|m2p|webm)$/i)
  ) {
    // 動画ファイルの場合
    if (loginuser == "" || loginuser == null || loginuser == "guest") {
      // 未ログインやゲストはHLS不許可
      location.href = targetElement.href;
    } else {
      if (
        targetElement.href.match(/\.mp4$/i) &&
        document.getElementById("rawMode").classList.contains("raw")
      ) {
        // mp4で圧縮モードrawの場合そのまま
        location.href = targetElement.href;
      } else {
        debugLog("LOGINED loginuser:" + loginuser);
        var openHref = hlsCgiPath + "?file=" + fileLink + "&mode=open";
        document.getElementById("history").innerHTML =
          '<a class="history_movie" href=' +
          location.origin +
          openHref +
          ">" +
          targetElement.innerText +
          "</a>";
        location.href = openHref;
      }
    }
  } else if (targetElement.href && targetElement.href.match(/\.(zip|cbz|rar|cbr|7z|cb7|pdf)$/i)) {
    // 書籍アーカイブの場合
    targetElement.parentNode.parentNode.firstChild.firstChild.firstChild.src =
      iconPath + "open.png";
    var openHref = cgiPath + "?file=" + fileLink + "&mode=open";
    if (document.getElementById("rawMode").classList.contains("raw")) {
      // 圧縮モードrawの場合
      // openHref = openHref + "&size=FULL";
    }
    document.getElementById("history").innerHTML =
      '<a class="history_book" href=' +
      location.origin +
      openHref +
      ">" +
      targetElement.innerText +
      "</a>";
    location.href = openHref;
  } else if (targetElement.href && targetElement.href.match(/\.epub$/i)) {
    // ePubの場合
    targetElement.parentNode.parentNode.firstChild.firstChild.firstChild.src =
      iconPath + "open.png";
    var openHref = bibiPath + "?book=" + publicDir + "/" + fileLink;
    document.getElementById("history").innerHTML =
      '<a class="history_book" href=' +
      location.origin +
      openHref +
      ">" +
      targetElement.innerText +
      "</a>";
    location.href = openHref;
  } else {
    // それ以外はそのまま
    // 通常のファイルアクセス処理（リーダー起動: mode=open を付与）
    location.href = cgiPath + "?mode=open&file=" + fileLink;
  }
  return false;
}

// ビューモード切り替え
function toggleView() {
  const stylesheet = document.getElementById("stylesheet");
  if (!stylesheet) return;

  if (/style\.css/.test(stylesheet.href || "")) {
    // List -> Cover
    document.cookie = "viewmode=cover; path=/; SameSite=Strict";
    stylesheet.href = "/theme/style_cover.css?2025080200";
    setTimeout(() => {
      try { reinitializeContentFeatures(); } catch (e) { console.error(e); }
      try { applyDirectoryCustomIcons(); } catch (e) { console.error(e); }
      try { reinitializePreviewFeatures(); } catch (e) { console.error(e); }
      try { updateCoverSideGutter(); } catch (e) {}
      // 表紙画像を動的に追加
      try { addCoverImages(); } catch (e) { console.error(e); }
      // ネットワークなしで既読/お気に入りを即時反映
      try { applyBookmarkCache(); } catch (e) { console.error(e); }
    }, 100);
  } else {
    // Cover -> List
    debugLog("DEBUG toggleView: Preparing to switch to list view");

    // CSS切り替え前にカスタムアイコンを事前にクリアしてちらつきを防ぐ
    const clearCustomIconsImmediately = () => {
      debugLog("DEBUG toggleView: Clearing custom icons immediately");
      const dirAnchors = document.querySelectorAll('.indexcolname a[href$="/"]');
      dirAnchors.forEach((anchor) => {
        // カバービューのカスタムアイコンを即座にクリア
        anchor.style.removeProperty("background-image");
        anchor.style.removeProperty("background-size");
        anchor.style.removeProperty("background-position");
        anchor.style.removeProperty("background-repeat");
      });
    };

    // 即座にカスタムアイコンをクリア
    clearCustomIconsImmediately();

    document.cookie = "viewmode=list; path=/; SameSite=Strict";
    stylesheet.href = "/theme/style.css?2025080200";

    setTimeout(() => {
      debugLog("DEBUG toggleView: Switching to list view, calling functions...");
      debugLog("DEBUG toggleView: Before reinitializeContentFeatures");
      try { debugIconVisibility(); } catch (e) { console.error(e); }

      try { reinitializeContentFeatures(); } catch (e) { console.error(e); }
      debugLog("DEBUG toggleView: After reinitializeContentFeatures");
      try { debugIconVisibility(); } catch (e) { console.error(e); }

      try { applyDirectoryCustomIcons(); } catch (e) { console.error(e); }
      debugLog("DEBUG toggleView: After applyDirectoryCustomIcons");
      try { debugIconVisibility(); } catch (e) { console.error(e); }

      // リストビューではプレビューを無効化
      try { clearPreviewEventListeners(); } catch (e) { console.error(e); }
      // 表紙画像を削除
      try { removeCoverImages(); } catch (e) { console.error(e); }
      debugLog("DEBUG toggleView: After removeCoverImages");
      try { debugIconVisibility(); } catch (e) { console.error(e); }

      // ネットワークなしで既読/お気に入りを即時反映
      try { applyBookmarkCache(); } catch (e) { console.error(e); }
      debugLog("DEBUG toggleView: List view switch completed");
    }, 50); // タイムアウトを50msに短縮
  }
}

// RAWモード切り替え
function toggleRaw() {
  const rawEl = document.getElementById("rawMode");
  if (!rawEl) return;
  const isRaw = rawEl.classList.contains("raw");
  if (isRaw) {
    rawEl.className = "cmp";
    document.cookie = "rawMode=cmp; path=/; SameSite=Strict";
  } else {
    rawEl.className = "raw";
    document.cookie = "rawMode=raw; path=/; SameSite=Strict";
  }
}

// Cookie取得ヘルパー関数
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(";").shift();
  return null;
}

// 言語メニュー切り替え
function switchLanguageMenu() {
  const menu = document.getElementById("languageMenu");
  if (menu.style.display === "none" || menu.style.display === "") {
    menu.style.display = "block";
    menu.style.left = "10px";
    menu.style.top = "50px";
  } else {
    menu.style.display = "none";
  }
}

// ログイン処理
function login() {
  const loginIcon = document.getElementById("loginIcon");
  if (loginIcon.className === "guest") {
    // ログイン処理
    const username = prompt("ユーザー名を入力してください:");
    if (username && username.trim()) {
      document.cookie =
        "comistreamUser=" +
        encodeURIComponent(username.trim()) +
        "; path=/; SameSite=Strict";
      location.reload();
    }
  } else {
    // ログアウト処理
    if (confirm("ログアウトしますか？")) {
      document.cookie =
        "comistreamUser=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict";
      location.reload();
    }
  }
}

// ソートパネル切り替え
function toggleSortPanel() {
  const panel = document.getElementById("sortPanel");
  const toggle = document.getElementById("sortToggle");
  if (!panel) return;

  // CSSアニメーション（.show）で開閉し、displayの直接操作はしない
  panel.classList.toggle("show");

  // トグルボタンの見た目（回転など）を同期
  if (toggle) {
    toggle.classList.toggle("active");
  }
}

// ヘッダーリンククリック時のソート処理（ページリロードなし・トグル動作）
function handleHeaderSort(sortBy) {
  debugLog('DEBUG handleHeaderSort called:', sortBy);
  
  let sortOrder;
  
  if (currentSortBy === sortBy) {
    // 現在のソート対象と同じカラムがクリックされた場合は逆順にする
    sortOrder = (currentSortOrder === 'asc') ? 'desc' : 'asc';
  } else {
    // 異なるカラムがクリックされた場合の処理
    if (sortBy === 'lastmod') {
      // 更新日時順への切り替えは常に降順から開始
      sortOrder = 'desc';
      
      // デフォルトの名前順・昇順から更新日時順への切り替えをログ出力
      if (currentSortBy === 'name' && currentSortOrder === 'asc') {
        debugLog("INFO: Switching from default name/asc to lastmod/desc");
      }
    } else if (sortBy === 'size') {
      sortOrder = 'desc';  // Sizeは降順が初期値
    } else {
      sortOrder = 'asc';   // Nameなどは昇順が初期値
    }
  }
  
  debugLog('DEBUG handleHeaderSort determined order:', sortBy, sortOrder);
  
  // ソート設定を更新
  changeSort(sortBy, sortOrder);
  
  // ソートパネルのselect要素も同期更新
  const sortBySelect = document.getElementById("sortBy");
  const sortOrderSelect = document.getElementById("sortOrder");
  if (sortBySelect) {
    sortBySelect.value = sortBy;
  }
  if (sortOrderSelect) {
    sortOrderSelect.value = sortOrder;
  }
  
  // ヘッダーのCSSクラスを更新
  updateHeaderSortClasses(sortBy, sortOrder);
  
  // applySortChange()と同じソート処理を実行
  applySortChangeCore();
}

// ヘッダーのソート状態を示すCSSクラスを更新
function updateHeaderSortClasses(currentSortBy, currentSortOrder) {
  debugLog('DEBUG updateHeaderSortClasses called:', currentSortBy, currentSortOrder);
  
  // 全てのヘッダーからソートクラスを削除
  const headerCells = document.querySelectorAll('th.indexcolname, th.indexcollastmod, th.indexcolsize');
  headerCells.forEach(cell => {
    cell.classList.remove('sort-asc', 'sort-desc');
  });
  
  // 現在のソート項目にクラスを追加
  let targetClass = '';
  switch (currentSortBy) {
    case 'name':
      targetClass = 'indexcolname';
      break;
    case 'lastmod':
      targetClass = 'indexcollastmod';
      break;
    case 'size':
      targetClass = 'indexcolsize';
      break;
  }
  
  if (targetClass) {
    const targetCell = document.querySelector(`th.${targetClass}`);
    if (targetCell) {
      targetCell.classList.add(`sort-${currentSortOrder}`);
      debugLog('DEBUG updateHeaderSortClasses: Applied class', `sort-${currentSortOrder}`, 'to', targetClass);
    }
  }
}

// ソート設定適用
function applySortChange() {
  const sortBySelect = document.getElementById("sortBy");
  const sortOrderSelect = document.getElementById("sortOrder");
  if (!sortBySelect || !sortOrderSelect) return;

  const selectedSortBy = sortBySelect.value;
  let selectedSortOrder = sortOrderSelect.value;

  // Name/asc から Last modified に切り替えたときは自動で desc を初期選択
  if (
    currentSortBy === "name" &&
    currentSortOrder === "asc" &&
    selectedSortBy === "lastmod"
  ) {
    selectedSortOrder = "desc";
    sortOrderSelect.value = "desc";
    debugLog("INFO: Switching from default name/asc to lastmod/desc");
  }

  // lastmod/size から name に戻すときは asc を初期選択
  if (
    (currentSortBy === "lastmod" || currentSortBy === "size") &&
    selectedSortBy === "name"
  ) {
    selectedSortOrder = "asc";
    sortOrderSelect.value = "asc";
    debugLog(
      "INFO: Switching from " +
        currentSortBy +
        "/" +
        currentSortOrder +
        " to name/asc"
    );
  }

  // ソート設定を変更
  changeSort(selectedSortBy, selectedSortOrder);

  // ヘッダーのCSSクラスを更新
  updateHeaderSortClasses(selectedSortBy, selectedSortOrder);

  // 実際のソート処理を実行
  applySortChangeCore();
}

// 共通のソート処理実行部分
function applySortChangeCore() {
  // 現在のソート設定を取得（既にグローバル変数が更新されている）
  const selectedSortBy = currentSortBy;
  const selectedSortOrder = currentSortOrder;

  // 現在のデータを再ソートして表示
  const tbody = document.querySelector('#table-tbody');
  if (tbody) {
    const rows = Array.from(tbody.querySelectorAll('tr:not(.parent-dir-row)'));
    if (rows.length > 0) {
      // 行データを収集
      const items = rows.map(row => {
        const nameCell = row.querySelector('.indexcolname a');
        const lastmodCell = row.querySelector('.indexcollastmod');
        const sizeCell = row.querySelector('.indexcolsize');

        if (!nameCell) return null;

        // data属性から値を取得、なければテキストから推測
        const name = nameCell.textContent || '';
        let lastmod = 0;
        let size = -1;
        let isDir = false;
        let isParent = false;

        // ディレクトリかどうかを判定
        const href = nameCell.getAttribute('href') || '';
        isDir = href.endsWith('/');

        // parent directoryかどうかを判定
        const dataFilepath = nameCell.getAttribute('data-filepath') || '';
        isParent = name === 'Parent Directory' || (dataFilepath && dataFilepath.includes('Parent Directory'));

        // lastmodを取得（data-timestamp属性があれば使用）
        if (lastmodCell) {
          const timestamp = lastmodCell.getAttribute('data-timestamp');
          if (timestamp) {
            lastmod = parseInt(timestamp);
          } else {
            // 日付文字列からタイムスタンプを推測
            const dateText = lastmodCell.textContent || '';
            const date = new Date(dateText);
            if (!isNaN(date.getTime())) {
              lastmod = Math.floor(date.getTime() / 1000);
            }
          }
        }

        // sizeを取得（data-size属性があれば使用）
        if (sizeCell) {
          const sizeAttr = sizeCell.getAttribute('data-size');
          if (sizeAttr) {
            size = parseInt(sizeAttr);
          } else {
            // サイズ文字列から数値を推測
            const sizeText = sizeCell.textContent || '';
            const sizeMatch = sizeText.match(/^([\d.]+)([KMGT]?)/);
            if (sizeMatch) {
              const num = parseFloat(sizeMatch[1]);
              const unit = sizeMatch[2];
              switch (unit) {
                case 'K': size = num * 1024; break;
                case 'M': size = num * 1024 * 1024; break;
                case 'G': size = num * 1024 * 1024 * 1024; break;
                case 'T': size = num * 1024 * 1024 * 1024 * 1024; break;
                default: size = num; break;
              }
            }
          }
        }

        return {
          name: name,
          lastmod: lastmod,
          size: size,
          is_dir: isDir,
          is_parent: isParent,
          rowElement: row
        };
      }).filter(item => item !== null);

      // ソート適用（ディレクトリとファイルを別々にソートしてから結合）
      debugLog('DEBUG applySortChangeCore: Starting client-side sort for', items.length, 'items');
      const sortStartTime = performance.now();
      const sortedItems = sortItemsWithSeparateDirsAndFiles(items, selectedSortBy, selectedSortOrder);
      const sortEndTime = performance.now();
      debugLog(`DEBUG applySortChangeCore: Sort completed in ${(sortEndTime - sortStartTime).toFixed(2)}ms`);

      // DOMを再構築
      const parentRow = tbody.querySelector('.parent-dir-row');
      tbody.innerHTML = '';

      // Parent Directoryを先頭に追加
      if (parentRow) {
        tbody.appendChild(parentRow);
      }

      // ソート済みの行を追加
      sortedItems.forEach(item => {
        tbody.appendChild(item.rowElement);
      });

      debugLog('Applied client-side sort:', selectedSortBy, selectedSortOrder);
    }
  }
}

// ソート設定の初期化
function initializeSortControls() {
  const sortBySelect = document.getElementById("sortBy");
  const sortOrderSelect = document.getElementById("sortOrder");

  // URLパラメータを優先、ない場合はlocalStorageから読み込み
  const urlLoaded = loadSortFromUrl();
  if (!urlLoaded) {
    loadSortSettings();
  }

  if (sortBySelect) {
    sortBySelect.value = currentSortBy;
    debugLog("DEBUG sortBySelect updated to:", sortBySelect.value);
  } else {
    debugLog("DEBUG sortBySelect not found");
  }
  if (sortOrderSelect) {
    sortOrderSelect.value = currentSortOrder;
    debugLog("DEBUG sortOrderSelect updated to:", sortOrderSelect.value);
  } else {
    debugLog("DEBUG sortOrderSelect not found");
  }

  // ヘッダーのCSSクラスも初期化
  updateHeaderSortClasses(currentSortBy, currentSortOrder);
}

function getBookmark() {
  // サーバからディレクトリ内の既読リストを取得（非同期）
  var pathName = comistreamConfig.currentPath;
  debugLog("DEBUG getBookmark called, pathName:", pathName);

  (async function () {
    const requestUrl = cgiPath + "?mode=list&file=" + encodeURIComponent(pathName);
    debugLog("DEBUG getBookmark request URL:", requestUrl);

    let listData = [];
    try {
      const response = await fetch(requestUrl, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      // JSONとして取得（空ボディの場合の安全策としてtext→parse）
      const bodyText = await response.text();
      listData = bodyText ? JSON.parse(bodyText) : [];
    } catch (e) {
      console.error("getBookmark fetch/parse error:", e);
      return;
    }

    debugLog(
      "DEBUG getBookmark parsed items:",
      Array.isArray(listData) ? listData.length : -1
    );

    var elementsFound = 0;
    var elementsUpdated = 0;

    // 取得データをキャッシュ用に整形
    try {
      const itemsMap = new Map();
      for (let j = 0; j < listData.length; j++) {
        const item = listData[j];
        if (!item || !(item.file || item.baseFile)) continue;
        const fileKey = item.file || item.baseFile;
        itemsMap.set(fileKey, {
          currentPage: Number((item.page ?? item.currentPage) || 0),
          maxPage: Number((item.max ?? item.maxPage) || 0),
          favorite: !!(item.fav ?? item.favorite),
        });
      }
      window._bookmarkCache = {
        path: comistreamConfig.currentPath,
        items: itemsMap,
      };
    } catch (e) {
      console.error("bookmark cache build failed:", e);
    }

    for (var j = 0; j < listData.length; j++) {
      var item = listData[j];
      if (!item || !(item.file || item.baseFile)) continue;

      var fileName = item.file || item.baseFile;
      var currentPage = Number((item.page ?? item.currentPage) || 0);
      var maxPage = Number((item.max ?? item.maxPage) || 0);
      var isFavorite = !!(item.fav ?? item.favorite);

      var elm = document.getElementById(fileName);
      debugLog(
        "DEBUG getBookmark item",
        j,
        "- filename:",
        fileName,
        "element found:",
        !!elm
      );

      // 要素が見つからない場合は、類似するIDがないか調査
      if (!elm) {
        debugLog(
          "DEBUG Searching for similar elements for filename:",
          fileName
        );
        const allIndexColName = document.getElementsByClassName("indexcolname");
        for (
          let searchIdx = 0;
          searchIdx < Math.min(allIndexColName.length, 10);
          searchIdx++
        ) {
          const searchElm = allIndexColName[searchIdx];
          const searchText = searchElm.firstChild
            ? searchElm.firstChild.textContent
            : "no text";
          debugLog(
            "DEBUG Element",
            searchIdx,
            "- id:",
            searchElm.id,
            "text:",
            searchText
          );
          if (searchText === fileName) {
            debugLog(
              "DEBUG Found matching text but different ID! Setting correct ID..."
            );
            searchElm.setAttribute("id", fileName);
            searchElm.id = fileName;
            elm = searchElm; // この要素を使用
            break;
          }
        }
      }

      if (elm) {
        elementsFound++;
        debugLog("DEBUG Element structure check for:", fileName);

        // 既読リストとIDがマッチする場合、現在ページと最終ページを比較★
        if (currentPage > 0) {
          if (currentPage < maxPage) {
            // 読みかけ
            debugLog("DEBUG Setting open icon for:", fileName);
            // <a>要素と<img>要素を確実に取得
            var iconLinkElements = elm.previousSibling
              ? elm.previousSibling.getElementsByTagName("a")
              : [];
            var iconImgElement = null;

            if (iconLinkElements.length > 0) {
              var imgElements = iconLinkElements[0].getElementsByTagName(
                "img"
              );
              if (imgElements.length > 0) {
                iconImgElement = imgElements[0];
              }
            }

            if (iconImgElement) {
              iconImgElement.src = iconPath + "open.png";
              elementsUpdated++;
              debugLog("Successfully set open icon for:", fileName);
            } else {
              console.error(
                "ERROR: Cannot find icon img element for:",
                fileName
              );
            }
          } else {
            // 読み終わった（最終ページ0に設定されている）
            debugLog("DEBUG Setting done icon for:", fileName);
            // <a>要素と<img>要素を確実に取得
            var iconLinkElements = elm.previousSibling
              ? elm.previousSibling.getElementsByTagName("a")
              : [];
            var iconImgElement = null;

            if (iconLinkElements.length > 0) {
              var imgElements = iconLinkElements[0].getElementsByTagName(
                "img"
              );
              if (imgElements.length > 0) {
                iconImgElement = imgElements[0];
              }
            }

            if (iconImgElement) {
              iconImgElement.src = iconPath + "done.png";
              elementsUpdated++;
              debugLog("Successfully set done icon for:", fileName);
            } else {
              console.error(
                "ERROR: Cannot find icon img element for:",
                fileName
              );
            }
          }
        }
        if (isFavorite) {
          debugLog("DEBUG Setting favorite for:", fileName);
          if (elm.previousSibling) {
            elm.previousSibling.style.backgroundPosition = "5px";
            elm.previousSibling.style.backgroundImage =
              'url("' + iconPath + 'staron.png")';
            elementsUpdated++;
            debugLog("Successfully set favorite for:", fileName);
          } else {
            console.error(
              "ERROR: Cannot set favorite - no previousSibling for:",
              fileName
            );
          }
        }
      } else if (fileName && fileName.trim()) {
        // 要素が見つからない場合のデバッグ情報
        debugLog(
          "DEBUG Element not found for filename:",
          fileName,
          "- Available IDs:",
          Array.from(document.querySelectorAll(".indexcolname"))
            .map((el) => el.id)
            .slice(0, 10)
        );
      }
    }

    debugLog(
      "DEBUG getBookmark completed - Elements found:",
      elementsFound,
      "Elements updated:",
      elementsUpdated
    );
  })();
}

// 既存のキャッシュから既読・お気に入り表示を再適用（ネットワークなしで即時）
function applyBookmarkCache() {
  try {
    if (!window._bookmarkCache) return;
    if (
      !comistreamConfig ||
      window._bookmarkCache.path !== comistreamConfig.currentPath
    )
      return;

    const items = window._bookmarkCache.items;
    if (!items || typeof items.forEach !== "function") return;

    let elementsFound = 0;
    let elementsUpdated = 0;

    items.forEach((data, fileName) => {
      let elm = document.getElementById(fileName);
      if (!elm) {
        // テキスト一致で救済
        const allIndexColName = document.getElementsByClassName("indexcolname");
        for (let searchIdx = 0; searchIdx < Math.min(allIndexColName.length, 10); searchIdx++) {
          const searchElm = allIndexColName[searchIdx];
          const searchText = searchElm.firstChild
            ? searchElm.firstChild.textContent
            : "no text";
          if (searchText === fileName) {
            searchElm.setAttribute("id", fileName);
            searchElm.id = fileName;
            elm = searchElm;
            break;
          }
        }
      }

      if (!elm) return;
      elementsFound++;

      // 既読アイコン再適用
      const currentPage = Number(data.currentPage || 0);
      const maxPage = Number(data.maxPage || 0);
      if (currentPage > 0) {
        // <a>要素と<img>要素を確実に取得
        const iconLinkElements = elm.previousSibling
          ? elm.previousSibling.getElementsByTagName("a")
          : [];
        let iconImgElement = null;
        if (iconLinkElements.length > 0) {
          const imgElements = iconLinkElements[0].getElementsByTagName("img");
          if (imgElements.length > 0) iconImgElement = imgElements[0];
        }
        if (iconImgElement) {
          iconImgElement.src =
            iconPath + (currentPage < maxPage ? "open.png" : "done.png");
          elementsUpdated++;
        }
      }

      // お気に入り再適用
      if (data.favorite && elm.previousSibling) {
        elm.previousSibling.style.backgroundPosition = "5px";
        elm.previousSibling.style.backgroundImage =
          'url("' + iconPath + 'staron.png")';
        elementsUpdated++;
      }
    });

    debugLog(
      "DEBUG applyBookmarkCache completed - Elements found:",
      elementsFound,
      "Elements updated:",
      elementsUpdated
    );
  } catch (e) {
    console.error("applyBookmarkCache failed:", e);
  }
}

// お気に入りフラグの設定
function toggleFavorite(e) {
  // data-filepath属性から正確なファイルパスを取得（#文字対応）
  var fileLink = getCleanFilePath(e.target.firstChild);

  // URLパラメータ用にエンコード
  fileLink = encodeURIComponent(fileLink)
    .replaceAll("&", "%26")
    .replaceAll("=", "%3D");

  // fileLink はこの直前で encodeURIComponent 済み（& と = も置換済み）なので再エンコードしない
  var favQuery = "file=" + fileLink + "&mode=";
  if (e.target.style.backgroundImage) {
    e.target.style.backgroundImage = "";
    e.target.style.backgroundPosition = "";
    favQuery = favQuery + "favOFF";
  } else {
    e.target.style.backgroundImage = 'url("' + iconPath + 'staron.png")';
    e.target.style.backgroundPosition = "5px";
    favQuery = favQuery + "favON";
  }

  navigator.sendBeacon(cgiPath, favQuery);

  // キャッシュも同期更新（UIと状態のズレを防止）
  try {
    if (window._bookmarkCache && window._bookmarkCache.items) {
      const linkEl = e.target.querySelector("a");
      const fileName = linkEl ? linkEl.textContent : null;
      if (fileName) {
        const prev = window._bookmarkCache.items.get(fileName) || {
          currentPage: 0,
          maxPage: 0,
          favorite: false,
        };
        window._bookmarkCache.items.set(fileName, {
          currentPage: prev.currentPage,
          maxPage: prev.maxPage,
          favorite: !prev.favorite,
        });
      }
    }
  } catch (err) {
    console.error("toggleFavorite cache sync failed:", err);
  }
}

// お気に入りフラグの検索
function searchFavButton() {
  if (document.getElementById("favbutton").style.backgroundImage) {
    document.getElementById("favbutton").style.backgroundImage = "";
    search();
  } else {
    document.getElementById("favbutton").style.backgroundImage =
      'url("' + iconPath + 'staron.png")';
    search();
  }
}

// 最後に開いたファイルの取得
function getHistory() {
  var pathName = comistreamConfig.currentPath;
  debugLog("DEBUG getHistory called, pathName:", pathName);

  var xmlHttp = new XMLHttpRequest();
  var requestUrl = cgiPath + "?mode=history&file=" + encodeURIComponent(pathName);
  debugLog("DEBUG getHistory request URL:", requestUrl);

  xmlHttp.open("GET", requestUrl, false);
  try {
    xmlHttp.send(null);
  } catch (e) {
    console.error("getHistory XMLHttpRequest error:", e);
    return;
  }

  debugLog("DEBUG getHistory response status:", xmlHttp.status);
  debugLog(
    "DEBUG getHistory response text length:",
    xmlHttp.responseText.length
  );

  if (xmlHttp.responseText) {
    debugLog(
      "DEBUG getHistory response text (first 200 chars):",
      xmlHttp.responseText.substring(0, 200)
    );

    // 履歴要素を更新
    const historyElement = document.getElementById("history");
    if (historyElement) {
      historyElement.innerHTML = xmlHttp.responseText;
      debugLog("DEBUG getHistory updated history element");
    } else {
      debugLog("DEBUG getHistory: history element not found");
    }
  }
}

// 検索機能
function search() {
  var textbox = document.searchform.textbox.value;
  debugLog("DEBUG search called with query:", textbox);

  var favOnly = document.getElementById("favbutton").style.backgroundImage
    ? true
    : false;
  debugLog("DEBUG search favOnly:", favOnly);

  // 全ての行を取得
  const tableBody = document.querySelector("#table-tbody");
  const rows = tableBody.querySelectorAll("tr");

  let visibleCount = 0;

  rows.forEach(function (row) {
    const nameCell = row.querySelector(".indexcolname");
    if (!nameCell) return;

    const fileName = nameCell.textContent || nameCell.innerText;
    const isParentDir = row.classList.contains("parent-dir-row");

    // 親ディレクトリは常に表示
    if (isParentDir) {
      row.style.display = "";
      return;
    }

    let shouldShow = true;

    // テキスト検索
    if (textbox && textbox.trim()) {
      const searchTerm = textbox.trim().toLowerCase();
      shouldShow = fileName.toLowerCase().includes(searchTerm);
    }

    // お気に入りフィルター
    if (shouldShow && favOnly) {
      const iconCell = row.querySelector(".indexcolicon");
      const hasStarBackground =
        iconCell &&
        iconCell.style.backgroundImage &&
        iconCell.style.backgroundImage.includes("staron.png");
      shouldShow = hasStarBackground;
    }

    row.style.display = shouldShow ? "" : "none";
    if (shouldShow) visibleCount++;
  });

  debugLog("DEBUG search completed, visible items:", visibleCount);
}

// プレビュー機能関連
function showPreview(imageSrc, element) {
  debugLog("DEBUG showPreview called with:", imageSrc);

  if (!modal || !modalImage) {
    console.error("Modal elements not found");
    return;
  }

  modalImage.src = imageSrc;
  modal.style.display = "block";

  // クリックで閉じる
  modal.onclick = function () {
    modal.style.display = "none";
  };
}

// 問題文字をパーセントエンコードする関数（PHP側のescape_problematic_chars()と同等）
function escapeProblematicChars(filepath) {
  if (!filepath) return "";
  
  // PHP側と同じ問題文字リスト（%は除外して二重エンコードを防ぐ）
  const problematicChars = ['#', '?', '&', '=', '\\', ':', '@', '<', '>', '"', "'", '|', '*', ' '];
  
  let result = filepath;
  problematicChars.forEach(char => {
    result = result.replaceAll(char, encodeURIComponent(char));
  });
  
  return result;
}

// 表紙画像を動的に追加する関数（リスト→カバービュー切り替え時）
function addCoverImages() {
  debugLog("DEBUG addCoverImages called");
  
  // 全てのファイル行を取得（parent-dir-rowは除外）
  const tableBody = document.querySelector("#table-tbody");
  const rows = tableBody.querySelectorAll("tr:not(.parent-dir-row)");
  
  let addedCount = 0;
  rows.forEach(function(row) {
    const nameCell = row.querySelector(".indexcolname");
    const anchor = nameCell ? nameCell.querySelector("a") : null;
    
    if (!anchor) return;
    
    // ディレクトリの場合は除外（hrefが/で終わるかdata-filepathで判断）
    const dataFilepath = anchor.getAttribute("data-filepath");
    const isDirectory = dataFilepath && dataFilepath.endsWith("/");
    
    if (isDirectory) {
      debugLog("DEBUG addCoverImages: Skipping directory:", dataFilepath);
      return;
    }
    
    // 既に表紙画像が存在する場合はスキップ
    if (nameCell.querySelector("img")) {
      debugLog("DEBUG addCoverImages: Cover image already exists for:", dataFilepath);
      return;
    }
    
    // 表紙画像パスを生成
    const coverImagePath = generateCoverImagePath(dataFilepath);
    if (!coverImagePath) return;
    
    // img要素を作成
    const img = document.createElement("img");
    img.src = coverImagePath;
    img.alt = "Cover";
    img.style.display = "block"; // 初期表示
    
    // エラー時は非表示にする
    img.onerror = function() {
      this.style.display = "none";
    };
    
    // nameCell の先頭に挿入（aタグの前）
    nameCell.insertBefore(img, anchor);
    addedCount++;
    
    debugLog("DEBUG addCoverImages: Added cover image for:", dataFilepath);
  });
  
  debugLog("DEBUG addCoverImages completed, added:", addedCount);
}

// 表紙画像を削除する関数（カバー→リストビュー切り替え時）
function removeCoverImages() {
  debugLog("DEBUG removeCoverImages called");

  const tableBody = document.querySelector("#table-tbody");
  const coverImages = tableBody.querySelectorAll(".indexcolname img");

  let removedCount = 0;
  coverImages.forEach(function(img) {
    img.remove();
    removedCount++;
  });

  debugLog("DEBUG removeCoverImages completed, removed:", removedCount);
}

// 表紙画像パスを生成する関数（PHP側の処理と同等）
function generateCoverImagePath(rawFilepath) {
  if (!rawFilepath) return null;
  
  // data-filepath から拡張子を.jpgに変更
  const coverPath = rawFilepath.replace(/\.[^.]+$/, '.jpg');
  
  // 問題文字をエスケープ
  const escapedCoverPath = escapeProblematicChars(coverPath);
  
  // 表紙画像URLを生成
  const coverImageUrl = '/theme/covers' + escapedCoverPath;
  
  debugLog("DEBUG generateCoverImagePath:", rawFilepath, "->", coverImageUrl);
  return coverImageUrl;
}

// デバッグ関数：アイコンの状態を確認
function debugIconVisibility() {
  debugLog("DEBUG debugIconVisibility called");

  const iconCells = document.querySelectorAll("#table-tbody td.indexcolicon");
  const nameCells = document.querySelectorAll("#table-tbody td.indexcolname");

  debugLog("DEBUG Icon cells found:", iconCells.length);
  debugLog("DEBUG Name cells found:", nameCells.length);

  iconCells.forEach((cell, index) => {
    const img = cell.querySelector("img");
    if (img) {
      debugLog(`DEBUG Icon ${index}: src=${img.src}, display=${img.style.display}, visibility=${img.style.visibility}, opacity=${img.style.opacity}`);
    } else {
      debugLog(`DEBUG Icon ${index}: No img element found`);
    }
  });

  nameCells.forEach((cell, index) => {
    const imgs = cell.querySelectorAll("img");
    if (imgs.length > 0) {
      debugLog(`DEBUG Name cell ${index}: Found ${imgs.length} images`);
      imgs.forEach((img, imgIndex) => {
        debugLog(`DEBUG Name cell ${index} img ${imgIndex}: alt=${img.alt}, display=${img.style.display}`);
      });
    }
  });
}

// カスタムディレクトリアイコン適用（カバービュー時に /theme/covers/<path>/index.webp を背景に設定）
function applyDirectoryCustomIcons() {
  debugLog("DEBUG applyDirectoryCustomIcons called");

  const imgBasePath = location.origin + "/theme/covers/";
  const stylesheet = document.getElementById("stylesheet");
  const isCoverView = stylesheet && /style_cover\.css/.test(stylesheet.href || "");

  const dirAnchors = document.querySelectorAll('.indexcolname a[href$="/"]');
  debugLog("DEBUG applyDirectoryCustomIcons: isCoverView =", isCoverView, ", dirAnchors =", dirAnchors.length);

  dirAnchors.forEach(function (anchor, index) {
    // リストビューでは通常のフォルダアイコンを表示（背景はクリア）
    if (!isCoverView) {
      debugLog(`DEBUG applyDirectoryCustomIcons: Processing directory ${index} for list view`);
      anchor.style.removeProperty("background-image");
      anchor.style.removeProperty("background-size");
      anchor.style.removeProperty("background-position");
      anchor.style.removeProperty("background-repeat");

      const iconImg = anchor.closest("tr")?.querySelector(".indexcolicon img");
      if (iconImg) {
        debugLog(`DEBUG applyDirectoryCustomIcons: Found icon img for directory ${index}, setting styles`);
        iconImg.style.display = "";
        iconImg.style.visibility = "";
        iconImg.style.opacity = "";
        // アイコンsrcを正しく設定
        if (!iconImg.src || iconImg.src.includes("blank.png")) {
          debugLog(`DEBUG applyDirectoryCustomIcons: Setting correct icon src for directory ${index}`);
          iconImg.src = iconPath + "folder.png";
        }
      } else {
        debugLog(`DEBUG applyDirectoryCustomIcons: No icon img found for directory ${index}`);
      }
      return;
    }

    // data-filepath を強制使用（href は # を含むとブラウザがフラグメント扱いするため）
    const encodedDataPath = anchor.getAttribute("data-filepath");
    if (!encodedDataPath) {
      // data-filepath が無いと安全に扱えないのでスキップ
      return;
    }

    // すでに percent-encode 済みのパスから相対パスを生成（先頭の / と publicDir を除去）
    let relativeEncodedPath = encodedDataPath;
    if (relativeEncodedPath.startsWith("/")) {
      relativeEncodedPath = relativeEncodedPath.substring(1);
    }
    const publicDirVal = typeof publicDir !== "undefined" ? publicDir : "";
    if (publicDirVal && relativeEncodedPath.startsWith(publicDirVal + "/")) {
      relativeEncodedPath = relativeEncodedPath.substring((publicDirVal + "/").length);
    }
    if (!relativeEncodedPath.endsWith("/")) {
      relativeEncodedPath += "/";
    }
    // CSS url() 内の安全性のため、シングルクォートだけは %27 に置換
    relativeEncodedPath = relativeEncodedPath.replace(/'/g, "%27");

    const dirCustomIconUrl = imgBasePath + relativeEncodedPath + "index.webp";

    // 画像を事前ロードして有効性チェック（サイズ 560x656）
    (function (linkEl, url) {
      const tmp = new Image();
      tmp.onload = function () {
        if (this.width === 560 && this.height === 656) {
          // カバービュー時のみ背景として適用
          linkEl.style.backgroundImage = "url('" + url + "')";
          linkEl.style.backgroundSize = "cover";
          linkEl.style.backgroundPosition = "center center";
          linkEl.style.backgroundRepeat = "no-repeat";
        } else {
          linkEl.style.removeProperty("background-image");
          linkEl.style.removeProperty("background-size");
          linkEl.style.removeProperty("background-position");
          linkEl.style.removeProperty("background-repeat");
        }
      };
      tmp.onerror = function () {
        linkEl.style.removeProperty("background-image");
        linkEl.style.removeProperty("background-size");
        linkEl.style.removeProperty("background-position");
        linkEl.style.removeProperty("background-repeat");
      };
      tmp.src = url;
    })(anchor, dirCustomIconUrl);
  });
}

// コンテンツ機能の再初期化
function reinitializeContentFeatures() {
  debugLog("DEBUG reinitializeContentFeatures called");

  // 検索機能の再初期化
  const searchForm = document.searchform;
  if (searchForm && searchForm.textbox) {
    searchForm.textbox.addEventListener("input", search);
    debugLog("DEBUG Search functionality reinitialized");
  }

  // ソート設定の再初期化
  initializeSortControls();

  // お気に入りボタンのイベント設定（inline onclick がある場合は二重バインドしない）
  const favButton = document.getElementById("favbutton");
  if (favButton) {
    if (!favButton.getAttribute("onclick")) {
      favButton.addEventListener("click", searchFavButton);
      debugLog("DEBUG Favorite button bound via addEventListener");
    } else {
      debugLog("DEBUG Favorite button uses inline onclick; skipping addEventListener");
    }
  }

  // 行ごとのお気に入りトグル（indexcoliconセルにクリックハンドラを設定）
  try {
    const iconCells = document.querySelectorAll("#table-tbody td.indexcolicon");
    let boundCount = 0;
    iconCells.forEach((cell) => {
      if (cell && cell.onclick !== toggleFavorite) {
        cell.onclick = toggleFavorite;
        boundCount++;
      }
    });
    debugLog("DEBUG Favorite toggle bound on icon cells:", boundCount);
  } catch (e) {
    console.error("ERROR binding favorite toggle:", e);
  }

  // 既存キャッシュがあれば即時反映
  try {
    applyBookmarkCache();
  } catch (e) {
    // 反映失敗は致命的ではないためログのみ
    console.error("applyBookmarkCache in reinitializeContentFeatures failed:", e);
  }
}

// プレビュー機能の再初期化
function reinitializePreviewFeatures() {
  debugLog("DEBUG reinitializePreviewFeatures called");

  // data-image属性はdir_list.phpで既に設定されているため、ここではイベントリスナーのみ設定
  const colname = document.getElementsByClassName("indexcolname");
  debugLog(
    "DEBUG reinitializePreviewFeatures found",
    colname.length,
    "elements"
  );

  // デバッグ：data-image属性が設定されているか確認
  for (let i = 2; i < Math.min(colname.length, 5); i++) {
    // 最初の数個だけチェック
    const dataImage = colname[i].getAttribute("data-image");
    debugLog(`DEBUG data-image check [${i}]:`, dataImage);
  }

  // マウスイベントリスナーを再設定（カバービューモードの場合のみ）
  const stylesheet = document.getElementById("stylesheet");
  const isCoverView = stylesheet && stylesheet.href.match(/style_cover\.css/);
  debugLog(
    "DEBUG isCoverView:",
    isCoverView,
    "hasHover:",
    window.matchMedia("(any-hover:hover)").matches
  );

  if (window.matchMedia("(any-hover:hover)").matches && isCoverView) {
    debugLog("DEBUG Setting up mouse events for preview");
    addMouseOverEvent();
    addMouseOutEvent();
  }

  // Ctrl+クリック機能も設定
  const previewElements = document.querySelectorAll("[data-image]");
  previewElements.forEach(function (element) {
    const imageUrl = element.getAttribute("data-image");
    if (imageUrl) {
      element.addEventListener("click", function (e) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          showPreview(imageUrl, element);
        }
      });
    }
  });

  debugLog(
    "DEBUG Preview features reinitialized for",
    previewElements.length,
    "elements"
  );

  // カバービューの左右ガターを再計算
  try {
    updateCoverSideGutter();
  } catch (e) {
    console.error("updateCoverSideGutter failed:", e);
  }
}

// プレビューイベントリスナーをクリアする関数
function clearPreviewEventListeners() {
  const cover = document.getElementsByClassName("indexcolname");
  for (let i = 0; i < cover.length; i++) {
    // タイマーをクリア
    if (cover[i]._previewShowTimer) {
      clearTimeout(cover[i]._previewShowTimer);
      delete cover[i]._previewShowTimer;
    }
    if (cover[i]._previewHideTimer) {
      clearTimeout(cover[i]._previewHideTimer);
      delete cover[i]._previewHideTimer;
    }

    // mouseoverイベントリスナーを削除
    if (cover[i]._mouseoverHandler) {
      cover[i].removeEventListener("mouseover", cover[i]._mouseoverHandler);
      delete cover[i]._mouseoverHandler;
    }

    // mouseoutイベントリスナーを削除
    if (cover[i]._mouseoutHandler) {
      cover[i].removeEventListener("mouseout", cover[i]._mouseoutHandler);
      delete cover[i]._mouseoutHandler;
    }
  }
}

// プレビュー画像表示（マウスオーバー）
function addMouseOverEvent() {
  const cover = document.getElementsByClassName("indexcolname");
  debugLog("DEBUG addMouseOverEvent called, found", cover.length, "elements");

  for (let i = 0; i < cover.length; i++) {
    // 既存のイベントリスナーがある場合は削除
    if (cover[i]._mouseoverHandler) {
      cover[i].removeEventListener("mouseover", cover[i]._mouseoverHandler);
    }

    // デバッグ：data-image属性をチェック
    const dataImage = cover[i].getAttribute("data-image");
    if (i >= 2 && i < 5) {
      // 最初の数個だけログ出力
      debugLog(`DEBUG addMouseOverEvent [${i}]: data-image="${dataImage}"`);
    }

    // 新しいイベントハンドラーを作成
    const mouseoverHandler = function (e) {
      if (document.getElementById("stylesheet").href.match(/style\.css/)) {
        // リストビューの場合は何もしない
      } else {
        // カバービューの時のみ動作
        const imageSrc = e.currentTarget.dataset.image;

        // 既存のタイマーをクリア
        if (e.currentTarget._previewShowTimer) {
          clearTimeout(e.currentTarget._previewShowTimer);
        }
        if (e.currentTarget._previewHideTimer) {
          clearTimeout(e.currentTarget._previewHideTimer);
          e.currentTarget._previewHideTimer = null;
        }

        debugLog("DEBUG hover preview - imageSrc:", imageSrc);

        if (typeof imageSrc !== "undefined" && imageSrc.length > 0) {
          // 150ms遅延してからプレビューを表示
          e.currentTarget._previewShowTimer = setTimeout(function () {
            if (!modalImage || !modal) {
              console.error("Modal elements not found");
              return;
            }

            modalImage.src = imageSrc;
            modalImage.onload = function () {
              // プレビュー画像の表示上の高さ（元の実装から移植）
              let previewWindowHeight = Math.round(
                (812 * document.documentElement.clientWidth) / 1734
              );

              // スタイルの初期化（以前の設定をリセット）
              modal.style.width = ""; // CSSのデフォルト（100%）に戻す

              // 画面サイズに応じた調整（元の実装から移植）
              if (
                previewWindowHeight * 2 >
                document.documentElement.clientHeight
              ) {
                // window縦幅がプレビュー画像の2倍より小さい場合は縮小
                modal.style.width = "50%";
                previewWindowHeight = Math.round(previewWindowHeight / 2);
              }
              // それ以外はCSSのwidth: 100%をそのまま使用（window幅一杯で表示）

              // マウス位置に基づいた表示位置計算（元の実装から移植）
              if (
                e.clientY + previewWindowHeight + 200 >
                document.documentElement.clientHeight
              ) {
                if (e.clientY - 200 - previewWindowHeight < 0) {
                  modal.style.top = "0px";
                } else {
                  // 下がはみ出る場合でも下に表示（ちらつき防止）
                  modal.style.top = e.clientY + 200 + "px";
                }
              } else {
                // 通常の下表示
                if (
                  e.clientY + 200 + previewWindowHeight >
                  document.documentElement.clientHeight
                ) {
                  modal.style.top =
                    document.documentElement.clientHeight -
                    previewWindowHeight +
                    "px";
                } else {
                  modal.style.top = e.clientY + 200 + "px";
                }
              }

              // モーダル表示（CSSのposition: fixed, width: 100%, height: 100%を活用）
              modal.style.display = "block";
            };
            modalImage.onerror = function () {
              debugLog("DEBUG hover preview - image load failed:", imageSrc);
            };
          }, 150); // 150ms遅延
        }
      }
    };

    // イベントハンドラーを要素に関連付けて保存
    cover[i]._mouseoverHandler = mouseoverHandler;
    // イベントリスナーを登録
    cover[i].addEventListener("mouseover", mouseoverHandler);
  }
}

// プレビュー画像非表示（マウスアウト）
function addMouseOutEvent() {
  const cover = document.getElementsByClassName("indexcolname");
  for (let i = 0; i < cover.length; i++) {
    // 既存のイベントリスナーがある場合は削除
    if (cover[i]._mouseoutHandler) {
      cover[i].removeEventListener("mouseout", cover[i]._mouseoutHandler);
    }

    // 新しいイベントハンドラーを作成
    const mouseoutHandler = function (e) {
      // 表示予約のタイマーをクリア
      if (e.currentTarget._previewShowTimer) {
        clearTimeout(e.currentTarget._previewShowTimer);
        e.currentTarget._previewShowTimer = null;
      }

      // 100ms遅延してからプレビューを非表示
      e.currentTarget._previewHideTimer = setTimeout(function () {
        if (modal) {
          modal.style.display = "none";
          debugLog("DEBUG mouseout preview hidden");
        }
      }, 100); // 100ms遅延
    };

    // イベントハンドラーを要素に関連付けて保存
    cover[i]._mouseoutHandler = mouseoutHandler;
    // イベントリスナーを登録
    cover[i].addEventListener("mouseout", mouseoutHandler);
  }
}

// 初期化関数
function initializeDirectoryListing() {
  debugLog("DEBUG initializeDirectoryListing called");

  // Long press script loading
  loadLongPressScript();

  // Event handlers setup
  setTimeout(function () {
    setupLongPressHandler();
    reinitializeContentFeatures();
    reinitializePreviewFeatures();
    initializeSortControls(); // ソート設定の初期化を追加
    try {
      updateCoverSideGutter();
    } catch (e) {}

    // カスタムディレクトリアイコンの適用（遅延実行）
    setTimeout(applyDirectoryCustomIcons, 500);

    debugLog("DEBUG Directory listing initialization completed");
  }, 100);
}

// DOMContentLoaded event listener
document.addEventListener("DOMContentLoaded", function () {
  debugLog("DEBUG DOMContentLoaded event fired");
  initializeDirectoryListing();
  try {
    updateCoverSideGutter();
  } catch (e) {}
});

// カバービューの左右ガター（外側余白）を計算してCSS変数に反映
function updateCoverSideGutter() {
  const stylesheet = document.getElementById("stylesheet");
  const isCoverView =
    stylesheet && /style_cover\.css/.test(stylesheet.href || "");
  const tableContainer = document.getElementById("indexlist");
  if (!tableContainer) return;
  if (!isCoverView) {
    tableContainer.style.removeProperty("--cover-side-gutter");
    return;
  }

  const slotWidth = 159 + 3 + 3; // card width + horizontal margins
  const containerWidth = tableContainer.clientWidth;
  if (!containerWidth) return;
  const columns = Math.max(1, Math.floor(containerWidth / slotWidth));
  const leftover = containerWidth - columns * slotWidth;
  const gutter = Math.max(0, Math.floor(leftover / 2));
  tableContainer.style.setProperty("--cover-side-gutter", gutter + "px");
}

let _coverGutterResizeTimer = null;
window.addEventListener("resize", function () {
  if (_coverGutterResizeTimer) clearTimeout(_coverGutterResizeTimer);
  _coverGutterResizeTimer = setTimeout(updateCoverSideGutter, 100);
});
