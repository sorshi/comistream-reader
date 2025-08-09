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
  // data-filepath属性から正確なファイルパスを取得（#文字対応）
  var fileLink = getCleanFilePath(e.target);

  // URLパラメータ用にエンコード
  fileLink = encodeURIComponent(fileLink)
    .replaceAll("&", "%26")
    .replaceAll("=", "%3D");

  document.getElementById("newname").value = e.target.innerText;
  document.getElementById("orgname").value = e.target.innerText;
  document.getElementById("fileLink").value = fileLink;
  document.getElementById("filemenu").style.display = "block";
  document.getElementById("filemenu").style.top = e.pageY + "px";
}

function openBookDetailMenu(e) {
  // data-filepath属性から正確なファイルパスを取得（#文字対応）
  var fileLink = getCleanFilePath(e.target);

  // URLパラメータ用にエンコード
  fileLink = encodeURIComponent(fileLink)
    .replaceAll("&", "%26")
    .replaceAll("=", "%3D");

  document.getElementById("fileA").value = e.target.innerText;
  document.getElementById("fileB").value = e.target.innerText;
  document.getElementById("detailFileLink").value = fileLink;
  document.getElementById("bookdetail").style.display = "block";
  document.getElementById("bookdetail").style.top = e.pageY + "px";
}

function linkhook(e) {
  // data-filepath属性から正確なファイルパスを取得（#文字対応）
  var fileLink = getCleanFilePath(e.target);

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

  // 音楽ファイルの場合
  if (
    e.target.href.match(/\.(mp3|m4a|aac|flac|aiff|aif|wav|wave|ogg|oga|wma)$/i)
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
      e.target.innerText +
      "</a>";
    location.href = musicPlayerHref;
    return false;
  }

  // ファイル種別に応じた処理を追加
  if (
    e.target.href.match(/\.(m2t|ts|iso|mp4|m4v|avi|mkv|wmv|mpg|m2p|webm)$/i)
  ) {
    // 動画ファイルの場合
    if (loginuser == "" || loginuser == null || loginuser == "guest") {
      // 未ログインやゲストはHLS不許可
      location.href = e.target.href;
    } else {
      if (
        e.target.href.match(/\.mp4$/i) &&
        document.getElementById("rawMode").classList.contains("raw")
      ) {
        // mp4で圧縮モードrawの場合そのまま
        location.href = e.target.href;
      } else {
        debugLog("LOGINED loginuser:" + loginuser);
        var openHref = hlsCgiPath + "?file=" + fileLink + "&mode=open";
        document.getElementById("history").innerHTML =
          '<a class="history_movie" href=' +
          location.origin +
          openHref +
          ">" +
          e.target.innerText +
          "</a>";
        location.href = openHref;
      }
    }
  } else if (e.target.href.match(/\.(zip|cbz|rar|cbr|7z|cb7|pdf)$/i)) {
    // 書籍アーカイブの場合
    e.target.parentNode.parentNode.firstChild.firstChild.firstChild.src =
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
      e.target.innerText +
      "</a>";
    location.href = openHref;
  } else if (e.target.href.match(/\.epub$/i)) {
    // ePubの場合
    e.target.parentNode.parentNode.firstChild.firstChild.firstChild.src =
      iconPath + "open.png";
    var openHref = bibiPath + "?book=" + publicDir + "/" + fileLink;
    document.getElementById("history").innerHTML =
      '<a class="history_book" href=' +
      location.origin +
      openHref +
      ">" +
      e.target.innerText +
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
  const viewmode = getCookie("viewmode") || "list";
  const newViewmode = viewmode === "cover" ? "list" : "cover";

  document.cookie = "viewmode=" + newViewmode + "; path=/; SameSite=Strict";
  location.reload();
}

// RAWモード切り替え
function toggleRaw() {
  const currentRaw = getCookie("rawMode") || "raw";
  const newRaw = currentRaw === "raw" ? "compressed" : "raw";

  document.cookie = "rawMode=" + newRaw + "; path=/; SameSite=Strict";
  location.reload();
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

// ソート設定適用
function applySortChange() {
  const sortBySelect = document.getElementById("sortBy");
  const sortOrderSelect = document.getElementById("sortOrder");
  if (!sortBySelect || !sortOrderSelect) return;

  const selectedSortBy = sortBySelect.value;
  let selectedSortOrder = sortOrderSelect.value;

  const currentSort =
    typeof comistreamConfig !== "undefined" && comistreamConfig.currentSort
      ? comistreamConfig.currentSort
      : "name";
  const currentOrder =
    typeof comistreamConfig !== "undefined" && comistreamConfig.currentOrder
      ? comistreamConfig.currentOrder
      : "asc";

  // Name/asc から Last modified に切り替えたときは自動で desc を初期選択
  if (
    currentSort === "name" &&
    currentOrder === "asc" &&
    selectedSortBy === "lastmod"
  ) {
    selectedSortOrder = "desc";
    sortOrderSelect.value = "desc";
    debugLog("INFO: Switching from default name/asc to lastmod/desc");
  }

  // lastmod/size から name に戻すときは asc を初期選択
  if (
    (currentSort === "lastmod" || currentSort === "size") &&
    selectedSortBy === "name"
  ) {
    selectedSortOrder = "asc";
    sortOrderSelect.value = "asc";
    debugLog(
      "INFO: Switching from " +
        currentSort +
        "/" +
        currentOrder +
        " to name/asc"
    );
  }

  const url = new URL(window.location);
  url.searchParams.set("sort", selectedSortBy);
  url.searchParams.set("order", selectedSortOrder);
  window.location.href = url.toString();
}

// ソート設定の初期化
function initializeSortControls() {
  const sortBySelect = document.getElementById("sortBy");
  const sortOrderSelect = document.getElementById("sortOrder");

  if (typeof comistreamConfig !== "undefined") {
    const currentSort = comistreamConfig.currentSort || "name";
    const currentOrder = comistreamConfig.currentOrder || "asc";

    if (sortBySelect) {
      sortBySelect.value = currentSort;
      debugLog("DEBUG sortBySelect updated to:", sortBySelect.value);
    } else {
      debugLog("DEBUG sortBySelect not found");
    }
    if (sortOrderSelect) {
      sortOrderSelect.value = currentOrder;
      debugLog("DEBUG sortOrderSelect updated to:", sortOrderSelect.value);
    } else {
      debugLog("DEBUG sortOrderSelect not found");
    }
  }
}

function getBookmark() {
  // サーバからディレクトリ内の既読リストを取得（非同期）
  var pathName = comistreamConfig.currentPath;
  debugLog("DEBUG getBookmark called, pathName:", pathName);

  (async function () {
    const requestUrl = cgiPath + "?mode=list&file=" + pathName;
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

    for (var j = 0; j < listData.length; j++) {
      var item = listData[j];
      if (!item || !item.baseFile) continue;

      var fileName = item.baseFile;
      var currentPage = Number(item.currentPage || 0);
      var maxPage = Number(item.maxPage || 0);
      var isFavorite = !!item.favorite;

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

// お気に入りフラグの設定
function toggleFavorite(e) {
  // data-filepath属性から正確なファイルパスを取得（#文字対応）
  var fileLink = getCleanFilePath(e.target.firstChild);

  // URLパラメータ用にエンコード
  fileLink = encodeURIComponent(fileLink)
    .replaceAll("&", "%26")
    .replaceAll("=", "%3D");

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
  var requestUrl = cgiPath + "?mode=history&file=" + pathName;
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

// カスタムディレクトリアイコン適用（カバービュー時に /theme/covers/<path>/index.webp を背景に設定）
function applyDirectoryCustomIcons() {
  debugLog("DEBUG applyDirectoryCustomIcons called");

  const imgBasePath = location.origin + "/theme/covers/";
  const stylesheet = document.getElementById("stylesheet");
  const isCoverView = stylesheet && /style_cover\.css/.test(stylesheet.href || "");

  const dirAnchors = document.querySelectorAll('.indexcolname a[href$="/"]');

  dirAnchors.forEach(function (anchor) {
    // リストビューでは通常のフォルダアイコンを表示（背景はクリア）
    if (!isCoverView) {
      anchor.style.removeProperty("background-image");
      anchor.style.removeProperty("background-size");
      anchor.style.removeProperty("background-position");
      anchor.style.removeProperty("background-repeat");
      const iconImg = anchor.closest("tr")?.querySelector(".indexcolicon img");
      if (iconImg) {
        iconImg.style.display = "";
        iconImg.style.visibility = "";
        iconImg.style.opacity = "";
      }
      return;
    }

    // data-filepath優先で正確なパスを取得
    let fullHref = anchor.getAttribute("data-filepath") || anchor.getAttribute("href") || "";
    if (fullHref) {
      try {
        fullHref = decodeURIComponent(fullHref);
      } catch (_) {
        // 失敗したらそのまま使う
      }
    }

    // publicDir 基準で相対パスを抽出
    let pathAfterPublicDir = "";
    const publicDirWithSlash = (typeof publicDir !== "undefined" ? publicDir : "") + "/";
    if (publicDir && fullHref.includes(publicDirWithSlash)) {
      pathAfterPublicDir = fullHref.substring(fullHref.indexOf(publicDirWithSlash) + publicDirWithSlash.length);
    } else {
      try {
        if (fullHref.startsWith("http://") || fullHref.startsWith("https://")) {
          const urlObj = new URL(fullHref);
          pathAfterPublicDir = urlObj.pathname;
        } else {
          pathAfterPublicDir = fullHref;
        }
        if (pathAfterPublicDir.startsWith("/")) pathAfterPublicDir = pathAfterPublicDir.substring(1);
      } catch (_) {
        pathAfterPublicDir = fullHref.replace(location.origin, "");
        if (pathAfterPublicDir.startsWith("/")) pathAfterPublicDir = pathAfterPublicDir.substring(1);
        if (publicDir && pathAfterPublicDir.startsWith(publicDirWithSlash)) {
          pathAfterPublicDir = pathAfterPublicDir.substring(publicDirWithSlash.length);
        }
      }
    }

    // 末尾に/を保証
    if (!pathAfterPublicDir.endsWith("/")) pathAfterPublicDir += "/";

    // ディレクトリ各パートを安全にエンコード（' も %27 へ）
    const parts = pathAfterPublicDir.split("/");
    let encodedParts = parts
      .slice(0, -1)
      .map(function (part) {
        let decoded = part;
        try {
          decoded = decodeURIComponent(part);
        } catch (_) {}
        return encodeURIComponent(decoded).replace(/'/g, "%27");
      });
    let relativeDirPath = encodedParts.join("/");
    if (pathAfterPublicDir.endsWith("/") && parts.length > 1) relativeDirPath += "/";

    const dirCustomIconUrl = imgBasePath + relativeDirPath + "index.webp";

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

  // お気に入りボタンのイベント設定
  const favButton = document.getElementById("favbutton");
  if (favButton) {
    favButton.addEventListener("click", searchFavButton);
    debugLog("DEBUG Favorite button reinitialized");
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

  const slotWidth = 150 + 3 + 3; // card width + horizontal margins
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
