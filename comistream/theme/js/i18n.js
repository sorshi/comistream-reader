/**
 * i18n.js - 多言語対応スクリプト
 * ディレクトリリスティング用
 */

// 利用可能な言語
const availableLanguages = {
  ja: "日本語",
  en: "English",
};

// グローバル変数
let currentLang = "ja";
let translations = {};

/**
 * 言語設定の取得（Cookieとlocal Storageから）
 */
function getCurrentLang() {
  // デフォルト言語をブラウザの言語設定から判断
  let lang = navigator.language.startsWith("ja") ? "ja" : "en";
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
      console.log(
        "localStorage に言語設定はありますが、対応していない言語です: " +
          localLang
      );
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
  script.src = themeDir + "/theme/lang/" + currentLang + ".js";
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
 * 言語選択メニューを生成
 */
function createLanguageSelector() {
  const langSelector = document.createElement("div");
  langSelector.className = "lang-selector";

  // 現在の言語を表示するボタン
  const currentLangBtn = document.createElement("a");
  currentLangBtn.className = "current-lang";
  currentLangBtn.href = "#";
  currentLangBtn.textContent = availableLanguages[currentLang] + " ▼";
  langSelector.appendChild(currentLangBtn);

  // ドロップダウンメニュー
  const langOptions = document.createElement("div");
  langOptions.className = "lang-options";
  langSelector.appendChild(langOptions);

  // 言語オプションの追加
  for (const [code, name] of Object.entries(availableLanguages)) {
    if (code !== currentLang) {
      const langOption = document.createElement("a");
      langOption.href = "#";
      langOption.textContent = name;
      langOption.dataset.lang = code;
      langOption.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        switchLanguage(this.dataset.lang);
      });
      langOptions.appendChild(langOption);
    }
  }

  // 現在の言語ボタンのクリックイベント
  currentLangBtn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    langOptions.classList.toggle("show");
  });

  // ドキュメントクリックでドロップダウンを閉じる
  document.addEventListener("click", function (e) {
    if (!langSelector.contains(e.target)) {
      langOptions.classList.remove("show");
    }
  });

  return langSelector;
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

    // 言語選択メニューを追加
    const menu = document.querySelector(".menu");
    if (menu) {
      const langSelector = createLanguageSelector();
      menu.appendChild(langSelector);
    }

    // CSSスタイルを動的に追加
    const style = document.createElement("style");
    style.textContent = `
      .lang-selector {
        float: right;
        margin-right: 10px;
        position: relative;
        z-index: 1100;
      }
      .current-lang {
        color: white;
        text-decoration: none;
        padding: 5px 10px;
        display: block;
        cursor: pointer;
      }
      .lang-options {
        display: none;
        position: absolute;
        background-color: rgba(0, 0, 0, 0.8);
        min-width: 120px;
        box-shadow: 0px 8px 16px 0px rgba(0,0,0,0.2);
        z-index: 1100;
        border-radius: 4px;
        top: 100%;
        right: 0;
      }
      .lang-options.show {
        display: block;
      }
      .lang-options a {
        color: white;
        padding: 12px 16px;
        text-decoration: none;
        display: block;
        cursor: pointer;
      }
      .lang-options a:hover {
        background-color: rgba(80, 80, 80, 0.8);
        border-radius: 4px;
      }
    `;
    document.head.appendChild(style);
  });
}

// DOMContentLoadedイベントで初期化
document.addEventListener("DOMContentLoaded", initI18n);
