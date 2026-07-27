/**
 * Comistream Reader - viewport計算ヘルパー
 *
 * DOM操作やReader状態の変更を持たない計算だけをまとめるルン。
 * ブラウザでは window.ComistreamViewport、Node.jsテストでは
 * module.exports から利用できるルン。
 */
(function (globalScope, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ComistreamViewport = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function toPositiveNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function toFiniteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function getLayoutViewportSize(view, documentElement) {
    const width = toPositiveNumber(
      view && view.innerWidth,
      toPositiveNumber(documentElement && documentElement.clientWidth)
    );
    const height = toPositiveNumber(
      view && view.innerHeight,
      toPositiveNumber(documentElement && documentElement.clientHeight)
    );

    return { width, height };
  }

  function shouldUseAutoLightSplit(options) {
    const viewportWidth = toPositiveNumber(options && options.viewportWidth);
    const viewportHeight = toPositiveNumber(options && options.viewportHeight);
    const imageWidth = toPositiveNumber(options && options.imageWidth);
    const imageHeight = toPositiveNumber(options && options.imageHeight);
    const pageNumber = Number(options && options.page);
    const pageMode = Number(options && options.mode);

    return (
      viewportWidth > 0 &&
      viewportHeight > 0 &&
      imageWidth > 0 &&
      imageHeight > 0 &&
      viewportWidth <= viewportHeight &&
      pageNumber !== 1 &&
      pageMode === 1 &&
      (options && options.autoSplit) !== "off" &&
      imageWidth >= imageHeight
    );
  }

  function calculateAutoLightSplitMetrics(options) {
    const viewportWidth = toPositiveNumber(options && options.viewportWidth);
    const viewportHeight = toPositiveNumber(options && options.viewportHeight);
    const imageWidth = toPositiveNumber(options && options.imageWidth);
    const imageHeight = toPositiveNumber(options && options.imageHeight);

    if (
      viewportWidth === 0 ||
      viewportHeight === 0 ||
      imageWidth === 0 ||
      imageHeight === 0
    ) {
      return null;
    }

    const isLandscapeImage = imageWidth >= imageHeight;
    const cutRate = isLandscapeImage ? 2 : 1;
    const ratio = Math.min(
      viewportWidth / (imageWidth / cutRate),
      viewportHeight / imageHeight
    );
    const backgroundWidth = Math.trunc(ratio * imageWidth);
    const backgroundHeight = Math.trunc(ratio * imageHeight);
    const halfImageWidth = Math.trunc((ratio * imageWidth) / 2);
    const readerWidth = Math.min(halfImageWidth, Math.trunc(viewportWidth));
    const marginLeft = Math.max(
      0,
      Math.trunc((viewportWidth - readerWidth) / 2)
    );

    return {
      isLandscapeImage,
      cutRate,
      ratio,
      backgroundWidth,
      backgroundHeight,
      readerWidth,
      marginLeft,
    };
  }

  function isLayoutRequestCurrent(options) {
    return (
      Number(options && options.requestId) ===
        Number(options && options.currentRequestId) &&
      (options && options.imageUrl) ===
        (options && options.currentImageUrl) &&
      (options && options.page) ===
        (options && options.currentPage) &&
      Number(options && options.mode) === 1
    );
  }

  function getViewportSegments(view) {
    try {
      const segments = view && view.viewport && view.viewport.segments;
      if (!segments) {
        return [];
      }

      return Array.from(segments, function (segment) {
        return {
          x: toFiniteNumber(segment && segment.x),
          y: toFiniteNumber(segment && segment.y),
          width: toPositiveNumber(segment && segment.width),
          height: toPositiveNumber(segment && segment.height),
        };
      });
    } catch (error) {
      return [];
    }
  }

  function createViewportSnapshot(
    view,
    documentElement,
    navigatorObject,
    screenObject
  ) {
    const layoutViewport = getLayoutViewportSize(view, documentElement);
    const visualViewport = view && view.visualViewport;
    const screenOrientation = screenObject && screenObject.orientation;
    const devicePosture =
      navigatorObject &&
      navigatorObject.devicePosture &&
      navigatorObject.devicePosture.type;

    return {
      layoutViewport,
      documentElement: {
        width: toPositiveNumber(documentElement && documentElement.clientWidth),
        height: toPositiveNumber(
          documentElement && documentElement.clientHeight
        ),
      },
      visualViewport: visualViewport
        ? {
            width: toPositiveNumber(visualViewport.width),
            height: toPositiveNumber(visualViewport.height),
            offsetLeft: toFiniteNumber(visualViewport.offsetLeft),
            offsetTop: toFiniteNumber(visualViewport.offsetTop),
            scale: toPositiveNumber(visualViewport.scale, 1),
          }
        : null,
      devicePixelRatio: toPositiveNumber(view && view.devicePixelRatio, 1),
      screenOrientation: screenOrientation
        ? {
            type:
              typeof screenOrientation.type === "string"
                ? screenOrientation.type
                : null,
            angle: toFiniteNumber(screenOrientation.angle),
          }
        : null,
      devicePosture:
        typeof devicePosture === "string" ? devicePosture : null,
      segments: getViewportSegments(view),
    };
  }

  return Object.freeze({
    getLayoutViewportSize,
    shouldUseAutoLightSplit,
    calculateAutoLightSplitMetrics,
    isLayoutRequestCurrent,
    getViewportSegments,
    createViewportSnapshot,
  });
});
