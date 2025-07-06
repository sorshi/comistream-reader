/**
 * i18n.js - 多言語対応スクリプト
 * ディレクトリリスティング用
 */

// 利用可能な言語
const availableLanguages = {
  ja: "日本語",
  en: "English",
  zh_TW: "繁體中文（台灣）",
  zh_HK: "繁體中文（香港）",
};

// グローバル変数
let currentLang = "en";
let translations = {};

/**
 * 言語設定の取得（Cookieとlocal Storageから）
 */
function getCurrentLang() {
  // デフォルト言語をブラウザの言語設定から判断
  let lang = "en"; // デフォルトは英語

  // ブラウザの言語設定を取得
  const browserLang = navigator.language;
  if (browserLang.startsWith("ja")) {
    lang = "ja";
  } else if (browserLang.startsWith("zh-TW")) {
    lang = "zh_TW";
  } else if (browserLang.startsWith("zh-HK")) {
    lang = "zh_HK";
  }
  // console.log("デフォルト言語設定: " +lang +" (navigator.language: " +navigator.language +")");

  // 1. Cookieから言語設定を取得（最優先）
  const cookies = document.cookie.split(";");
  // console.log("Cookieの内容: ", cookies);

  for (let cookie of cookies) {
    const [name, value] = cookie.trim().split("=");
    if (name === "lang") {
      // console.log("Cookie から lang を検出: " + value);
      // 設定された言語が利用可能な言語リストに含まれているか確認
      if (Object.keys(availableLanguages).includes(value)) {
        // console.log("有効な言語設定を Cookie から取得: " + value);
        return value; // 有効なCookie値があればそれを返す
      } else {
        // console.log("Cookie に言語設定はありますが、対応していない言語です: " + value);
      }
    }
  }

  // 2. localStorageから言語設定を取得（次に優先）
  try {
    const localLang = localStorage.getItem("lang");
    // console.log("localStorage から lang を検出: " + localLang);

    if (localLang && Object.keys(availableLanguages).includes(localLang)) {
      // localStorageから取得した値をCookieにも反映
      document.cookie = "lang=" + localLang + ";path=/;max-age=" + 86400 * 31;
      // console.log("有効な言語設定を localStorage から取得し、Cookie にも設定: " +localLang);
      return localLang;
    } else if (localLang) {
      // console.log("localStorage に言語設定はありますが、対応していない言語です: " +localLang);
    }
  } catch (e) {
    // localStorageにアクセスできなかった場合（プライベートモードなど）
    // console.log("localStorage にアクセスできません: " + e.message);
  }

  // 3. 上記で見つからなければブラウザのデフォルト言語を使用
  // console.log("Cookie と localStorage に言語設定がないため、デフォルト言語を使用: " + lang);
  return lang;
}

/**
 * 言語ファイルを読み込む
 */
function loadLanguageFile(callback) {
  currentLang = getCurrentLang();
  const script = document.createElement("script");
  script.src = "/theme/lang/" + currentLang + ".js";
  script.onload = function () {
    translations = i18n_translations;
    if (callback) callback();
  };
  document.head.appendChild(script);
}

/**
 * テキストを翻訳する
 */
function _(key) {
  return translations[key] || key;
}

/**
 * 言語切り替え
 */
function switchLanguage(lang) {
  if (Object.keys(availableLanguages).includes(lang)) {
    // Cookieに言語設定を保存（31日間有効）
    document.cookie = "lang=" + lang + ";path=/;max-age=" + 86400 * 31;

    // localStorageにも言語設定を保存
    try {
      localStorage.setItem("lang", lang);
    } catch (e) {
      // console.log("localStorage is not accessible");
    }

    // ページをリロード
    window.location.reload();
  }
}

/**
 * 言語メニューの表示/非表示を切り替える
 */
function switchLanguageMenu() {
  const menu    = document.getElementById("languageMenu");
  const icon    = document.getElementById("languageIcon");
  const options = document.getElementById("languageOptions");
  if (!menu || !icon || !options) return;   // silently abort if elements missing

  // 言語オプションが空の場合は作成
  if (!options.children.length) {
    for (const [code, name] of Object.entries(availableLanguages)) {
      const langBtn = document.createElement("div");
      langBtn.textContent = name;
      langBtn.style.padding = "8px 16px";
      langBtn.style.cursor = "pointer";
      langBtn.style.color = code === currentLang ? "#ffcc00" : "white";
      langBtn.style.fontWeight = code === currentLang ? "bold" : "normal";
      langBtn.style.borderRadius = "4px";

      langBtn.addEventListener("mouseover", function () {
        this.style.backgroundColor = "rgba(255,255,255,0.2)";
      });

      langBtn.addEventListener("mouseout", function () {
        this.style.backgroundColor = "transparent";
      });

      langBtn.addEventListener("click", function () {
        switchLanguage(code);
      });

      options.appendChild(langBtn);
    }
  }

  // メニューの位置調整
  const rect = icon.getBoundingClientRect();
  menu.style.top = rect.bottom + window.scrollY + "px";
  menu.style.left = rect.left + window.scrollX - 40 + "px";

  // 表示/非表示の切り替え
  if (menu.style.display === "none" || !menu.style.display) {
    menu.style.display = "block";

    // ドキュメントクリックでメニューを閉じる
    const closeMenu = function (e) {
      if (!menu.contains(e.target) && e.target !== icon) {
        menu.style.display = "none";
        document.removeEventListener("click", closeMenu);
      }
    };

    // イベントリスナーを遅延して追加（現在のクリックが反応しないように）
    setTimeout(() => {
      document.addEventListener("click", closeMenu);
    }, 10);
  } else {
    menu.style.display = "none";
  }
}

/**
 * ページ内のテキストを翻訳
 */
function translatePage() {
  // フォーム内のボタンとラベルを翻訳
  document
    .querySelectorAll('input[type="button"], input[type="submit"]')
    .forEach((elem) => {
      const key = elem.value.toLowerCase().replace(/\s+/g, "_");
      if (translations[key]) {
        elem.value = translations[key];
      } else if (translations[elem.name]) {
        elem.value = translations[elem.name];
      }
    });

  // 検索プレースホルダーを翻訳
  const searchInput = document.querySelector('input[type="search"]');
  if (searchInput) {
    searchInput.placeholder = _("search_files");
  }

  // ソート関連のテキストを翻訳
  const sortLabel = document.getElementById('sortLabel');
  if (sortLabel) {
    sortLabel.textContent = _("sort") + ':';
  }

  // ソート項目のオプションを翻訳
  const sortBySelect = document.getElementById('sortBy');
  if (sortBySelect) {
    const options = sortBySelect.options;
    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      if (option.value === 'name') {
        option.textContent = _("sort_by_name");
      } else if (option.value === 'lastmod') {
        option.textContent = _("sort_by_lastmod");
      } else if (option.value === 'size') {
        option.textContent = _("sort_by_size");
      }
    }
  }

  // ソート順序のオプションを翻訳
  const sortOrderSelect = document.getElementById('sortOrder');
  if (sortOrderSelect) {
    const options = sortOrderSelect.options;
    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      if (option.value === 'asc') {
        option.textContent = _("sort_asc");
      } else if (option.value === 'desc') {
        option.textContent = _("sort_desc");
      }
    }
  }

  // その他のUIテキストを翻訳（必要に応じて追加）
}

/**
 * 初期化処理
 */
function initI18n() {
  // 言語ファイルを読み込み、読み込み完了後に翻訳処理を実行
  loadLanguageFile(function () {
    // ページ内のテキストを翻訳
    translatePage();
  });
}

// DOMContentLoadedイベントで初期化
document.addEventListener("DOMContentLoaded", initI18n);
