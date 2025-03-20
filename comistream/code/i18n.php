<?php

/**
 * Comistream Internationalization
 *
 * 多言語化機能を提供するライブラリファイル
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     GPL3.0 License
 * @version     1.0.1
 * @link        https://github.com/sorshi/comistream-reader
 */

class I18n
{
    private static $instance = null;
    private $lang = 'ja'; // デフォルト言語
    private $translations = [];
    private $availableLangs = [
        'ja' => '日本語',
        'en' => 'English'
    ];

    /**
     * コンストラクタ
     */
    private function __construct()
    {
        // 言語の決定 (優先順位: Cookie > localStorage > Accept-Language)
        $this->detectLanguage();
        $this->loadTranslations();
    }

    /**
     * シングルトンインスタンスを取得
     */
    public static function getInstance()
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * 言語を検出して設定
     */
    private function detectLanguage()
    {
        error_log("detectLanguage - 言語検出開始");
        // 1. Cookieから言語設定を取得
        if (isset($_COOKIE['lang'])) {
            error_log("Cookie lang値: " . $_COOKIE['lang']);
            if (array_key_exists($_COOKIE['lang'], $this->availableLangs)) {
                $this->lang = $_COOKIE['lang'];
                error_log("Cookie から言語設定: " . $this->lang);
                return;
            } else {
                error_log("Cookie に言語設定はありますが、対応していない言語です: " . $_COOKIE['lang']);
            }
        } else {
            error_log("Cookie に言語設定はありません");
        }

        // 2. Accept-Languageヘッダから言語設定を取得
        if (isset($_SERVER['HTTP_ACCEPT_LANGUAGE'])) {
            $browserLangs = explode(',', $_SERVER['HTTP_ACCEPT_LANGUAGE']);
            error_log("ブラウザ言語: " . $_SERVER['HTTP_ACCEPT_LANGUAGE']);
            foreach ($browserLangs as $browserLang) {
                $langCode = substr($browserLang, 0, 2);
                if ($langCode === 'ja') {
                    $this->lang = 'ja';
                    error_log("ブラウザ言語から言語設定: " . $this->lang);
                    return;
                } elseif ($langCode === 'en') {
                    $this->lang = 'en';
                    error_log("ブラウザ言語から言語設定: " . $this->lang);
                    return;
                }
            }
        } else {
            error_log("ブラウザ言語設定はありません");
        }
        
        error_log("デフォルト言語を使用: " . $this->lang);
    }

    /**
     * 言語ファイルを読み込む
     */
    private function loadTranslations()
    {
        $langFile = __DIR__ . '/../lang/' . $this->lang . '.php';
        // 短縮形から詳細形へのマッピング
        $langMap = [
            'ja' => 'ja_JP',
            'en' => 'en_US'
        ];
        
        $mappedLang = isset($langMap[$this->lang]) ? $langMap[$this->lang] : $this->lang;
        $langFile = __DIR__ . '/../lang/' . $mappedLang . '.php';
        
        error_log("言語ファイル読み込み: " . $langFile);
        if (file_exists($langFile)) {
            $this->translations = require($langFile);
            error_log("言語ファイル読み込み成功");
        } else {
            // デフォルト言語のファイルが見つからない場合は空の配列を設定
            $this->translations = [];
            error_log("言語ファイルが見つかりません: " . $langFile);
        }
    }

    /**
     * 翻訳テキストを取得
     */
    public function get($key, $default = null)
    {
        if (isset($this->translations[$key])) {
            return $this->translations[$key];
        }
        return $default ?? $key;
    }

    /**
     * 現在の言語を取得
     */
    public function getCurrentLang()
    {
        return $this->lang;
    }

    /**
     * 言語を設定
     */
    public function setLang($lang)
    {
        if (array_key_exists($lang, $this->availableLangs)) {
            $this->lang = $lang;
            $this->loadTranslations();

            // Cookieに保存（31日間有効）
            setcookie('lang', $lang, time() + 86400 * 31, '/');

            return true;
        }
        return false;
    }

    /**
     * 利用可能な言語のリストを取得
     */
    public function getAvailableLangs()
    {
        return $this->availableLangs;
    }

    /**
     * 言語選択のHTMLを生成
     */
    public function getLangSelectorHtml()
    {
        $html = '<div class="lang-selector">';
        $html .= '<div class="lang-current">';

        // 現在選択中の言語を表示
        $html .= '<a href="#" class="lang-selected">▼</a>';
        $html .= '<div class="lang-dropdown">';

        // 全言語のリストをドロップダウンに表示
        foreach ($this->availableLangs as $code => $name) {
            if ($code !== $this->lang) { // 現在選択中の言語以外を表示
                $html .= '<a href="#" class="lang-option" data-lang="' . $code . '">' . $name . '</a>';
            }
        }

        $html .= '</div></div></div>';
        return $html;
    }

    /**
     * 言語切り替えのためのJavaScriptを生成
     */
    public function getLangSwitcherJs()
    {
        return <<<JS
        // 言語切り替え処理
        function switchLanguage(lang) {
            // Cookieに言語設定を保存
            document.cookie = "lang=" + lang + ";path=/;max-age=" + (86400 * 31);

            // localStorageにも保存
            localStorage.setItem('lang', lang);

            // ページをリロード
            window.location.reload();
        }

        // ドロップダウンの表示/非表示切り替え
        document.addEventListener('DOMContentLoaded', function() {
            var langSelected = document.querySelector('.lang-selected');
            var langDropdown = document.querySelector('.lang-dropdown');

            // 言語選択ボタンのクリックイベント
            if (langSelected) {
                langSelected.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    langDropdown.classList.toggle('show');
                });
            }

            // 言語オプションのクリックイベント
            var langOptions = document.querySelectorAll('.lang-option');
            langOptions.forEach(function(option) {
                option.addEventListener('click', function(e) {
                    e.preventDefault();
                    switchLanguage(this.getAttribute('data-lang'));
                });
            });

            // ドロップダウン外クリックで閉じる
            document.addEventListener('click', function() {
                if (langDropdown) {
                    langDropdown.classList.remove('show');
                }
            });
        });
JS;
    }
}
