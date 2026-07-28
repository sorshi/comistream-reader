/*
 * Comistream Reader Markers
 *
 * 画像/PDF/EPUBリーダーで共通のしおりUIと保存処理を提供するルン。
 */

(function readerMarkersModule(global) {
  "use strict";

  const MARKER_LIMIT = 100;
  const LOCAL_STORAGE_VERSION = 1;
  const CLUSTER_DISTANCE_PX = 16;
  const PROGRESS_EPSILON = 1e-7;
  const DEFAULT_SLIDER_THUMB_SIZE_PX = 30;
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function optionalFiniteNumber(value) {
    if (value === null || typeof value === "undefined" || value === "") {
      return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizedFraction(marker) {
    const value = Number(marker?.progressFraction);
    return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
  }

  function rangeValueFraction(value, min, max) {
    const numericValue = optionalFiniteNumber(value);
    const numericMin = optionalFiniteNumber(min);
    const numericMax = optionalFiniteNumber(max);
    if (
      numericValue === null ||
      numericMin === null ||
      numericMax === null ||
      numericMax <= numericMin
    ) {
      return 0.5;
    }
    return clamp(
      (numericValue - numericMin) / (numericMax - numericMin),
      0,
      1
    );
  }

  function rangeThumbCenterX(fraction, sliderWidth, thumbSize) {
    const width = Math.max(0, Number(sliderWidth) || 0);
    const size = clamp(Number(thumbSize) || 0, 0, width);
    if (width <= size) {
      return width / 2;
    }
    return size / 2 + clamp(Number(fraction) || 0, 0, 1) * (width - size);
  }

  function createBookmarkIcon() {
    const icon = document.createElement("span");
    icon.className = "reader-marker-icon";
    icon.setAttribute("aria-hidden", "true");

    // 一覧では位置記号ではなく、保存済みのしおりだと伝えるルン。
    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z");
    svg.appendChild(path);
    icon.appendChild(svg);
    return icon;
  }

  function compareMarkers(left, right) {
    if (left.locatorType === "page" || right.locatorType === "page") {
      const pageDifference =
        (Number(left.pageNumber) || 0) - (Number(right.pageNumber) || 0);
      if (pageDifference !== 0) return pageDifference;
    }

    const progressDifference =
      normalizedFraction(left) - normalizedFraction(right);
    if (progressDifference !== 0) return progressDifference;

    const sectionDifference =
      (Number(left.sectionIndex) || 0) - (Number(right.sectionIndex) || 0);
    if (sectionDifference !== 0) return sectionDifference;

    return String(left.id).localeCompare(String(right.id));
  }

  function mergePageJumpStops(chapterStops, markers, maxPage) {
    const upperBound = Number(maxPage);
    const isValidPage = (value) => {
      const pageNumber = Number(value);
      return (
        Number.isInteger(pageNumber) &&
        pageNumber >= 1 &&
        (!Number.isFinite(upperBound) || pageNumber <= upperBound)
      );
    };
    const markerStops = Array.isArray(markers)
      ? markers
          .filter((marker) => marker?.locatorType === "page")
          .map((marker) => marker.pageNumber ?? marker.locator)
      : [];

    // 章としおりが同じページでも停止点は1つにまとめるルン。
    return Array.from(
      new Set(
        [...(Array.isArray(chapterStops) ? chapterStops : []), ...markerStops]
          .filter(isValidPage)
          .map(Number)
      )
    ).sort((left, right) => left - right);
  }

  function findAdjacentPageStop(stops, currentPage, pageMode, previous) {
    const pageNumber = Number(currentPage);
    const visiblePageCount = Math.max(1, Number(pageMode) || 1);
    const orderedStops = (Array.isArray(stops) ? stops : [])
      .map(Number)
      .filter(Number.isInteger)
      .sort((left, right) => left - right);

    if (previous) {
      for (let index = orderedStops.length - 1; index >= 0; index -= 1) {
        if (orderedStops[index] < pageNumber) {
          return orderedStops[index];
        }
      }
      return null;
    }

    const visibleLastPage = pageNumber + visiblePageCount - 1;
    return orderedStops.find((stop) => stop > visibleLastPage) ?? null;
  }

  function findAdjacentMarker(
    markers,
    currentFraction,
    previous,
    currentLocator = ""
  ) {
    const normalizedCurrentFraction = clamp(
      Number(currentFraction) || 0,
      0,
      1
    );
    const locator = String(currentLocator || "");
    const candidates = (Array.isArray(markers) ? markers : []).filter((marker) => {
      if (!marker || typeof marker.locator !== "string" || marker.locator === "") {
        return false;
      }
      if (locator !== "" && marker.locator === locator) {
        return false;
      }
      const difference =
        normalizedFraction(marker) - normalizedCurrentFraction;
      return previous
        ? difference < -PROGRESS_EPSILON
        : difference > PROGRESS_EPSILON;
    });

    candidates.sort((left, right) => {
      const progressDifference =
        normalizedFraction(left) - normalizedFraction(right);
      if (progressDifference !== 0) {
        return previous ? -progressDifference : progressDifference;
      }
      return compareMarkers(left, right);
    });
    return candidates[0] || null;
  }

  class ReaderMarkerManager {
    constructor(options) {
      this.options = options || {};
      this.markers = [];
      this.busy = false;
      this.initialized = false;
      this.resizeObserver = null;
      this.localStorageKey =
        `comistream_reader_markers:v${LOCAL_STORAGE_VERSION}:` +
        String(this.options.baseFile || this.options.file || "");
    }

    text(key, fallback) {
      const value = this.options.i18n?.[key];
      return typeof value === "string" && value !== "" ? value : fallback;
    }

    element(id) {
      return id ? document.getElementById(id) : null;
    }

    setStatus(message, isError = false) {
      const status = this.element(this.options.statusId);
      if (!status) return;
      status.textContent = message || "";
      status.classList.toggle("reader-marker-status-error", isError);
    }

    async init() {
      if (this.initialized) return;
      this.initialized = true;

      this.element(this.options.addButtonId)?.addEventListener("click", () => {
        void this.addCurrent();
      });

      const slider = this.element(this.options.sliderId);
      if (slider && typeof ResizeObserver === "function") {
        this.resizeObserver = new ResizeObserver(() => this.renderRail());
        this.resizeObserver.observe(slider);
      }

      await this.refresh();
    }

    async refresh() {
      try {
        this.markers = this.options.isGuest
          ? this.readLocalMarkers()
          : await this.requestServerList();
        this.sortMarkers();
        this.render();
      } catch (error) {
        console.error("Reader marker refresh failed.", error);
        this.setStatus(this.text("reader_marker_error", "Unable to load bookmarks."), true);
      }
    }

    sortMarkers() {
      this.markers.sort(compareMarkers);
    }

    readLocalMarkers() {
      try {
        const stored = JSON.parse(localStorage.getItem(this.localStorageKey) || "[]");
        return Array.isArray(stored) ? stored.slice(0, MARKER_LIMIT) : [];
      } catch (error) {
        console.warn("Invalid local reader marker data was ignored.", error);
        this.setStatus(
          this.text("reader_marker_error", "Unable to load bookmarks."),
          true
        );
        return [];
      }
    }

    writeLocalMarkers(markers = this.markers) {
      localStorage.setItem(this.localStorageKey, JSON.stringify(markers));
    }

    async requestServerList() {
      const query = new URLSearchParams({
        mode: "markerList",
        file: String(this.options.file || ""),
      });
      const response = await fetch(`comistream.php?${query.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = await this.parseResponse(response);
      return Array.isArray(payload.markers) ? payload.markers : [];
    }

    async requestServer(mode, values) {
      const data = new FormData();
      data.append("mode", mode);
      data.append("csrf_token", String(this.options.csrfToken || ""));
      for (const [key, value] of Object.entries(values || {})) {
        if (value !== null && typeof value !== "undefined") {
          data.append(key, String(value));
        }
      }

      const response = await fetch("comistream.php", {
        method: "POST",
        body: data,
        credentials: "same-origin",
        cache: "no-store",
      });
      return this.parseResponse(response);
    }

    async parseResponse(response) {
      let payload = {};
      try {
        payload = await response.json();
      } catch (_error) {
        throw new Error(`reader_marker_http_${response.status}`);
      }
      if (!response.ok || payload.ok !== true) {
        const error = new Error(payload.error || `reader_marker_http_${response.status}`);
        error.code = payload.error || "";
        throw error;
      }
      return payload;
    }

    async addCurrent() {
      if (this.busy) return;
      if (this.markers.length >= MARKER_LIMIT) {
        this.setStatus(this.text("reader_marker_limit", "Up to 100 bookmarks per book."), true);
        return;
      }

      const snapshot = await this.options.getCurrentMarker?.();
      if (!snapshot?.locator || !snapshot?.locatorType) {
        this.setStatus(this.text("reader_marker_error", "Unable to save this bookmark."), true);
        return;
      }

      this.busy = true;
      this.updateAddButton();
      try {
        if (this.options.isGuest) {
          const duplicateIndex = this.markers.findIndex(
            (marker) =>
              marker.locatorType === snapshot.locatorType &&
              marker.locator === snapshot.locator
          );
          const marker = {
            ...snapshot,
            id:
              duplicateIndex >= 0
                ? this.markers[duplicateIndex].id
                : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            customLabel:
              duplicateIndex >= 0
                ? this.markers[duplicateIndex].customLabel || null
                : null,
            createdAt:
              duplicateIndex >= 0
                ? this.markers[duplicateIndex].createdAt
                : new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          const nextMarkers = [...this.markers];
          if (duplicateIndex >= 0) {
            nextMarkers[duplicateIndex] = marker;
          } else {
            nextMarkers.push(marker);
          }
          nextMarkers.sort(compareMarkers);
          this.writeLocalMarkers(nextMarkers);
          this.markers = nextMarkers;
          this.sortMarkers();
        } else {
          const payload = await this.requestServer("markerAdd", {
            file: this.options.file,
            format: snapshot.format,
            locator_type: snapshot.locatorType,
            locator: snapshot.locator,
            page_number: snapshot.pageNumber,
            section_index: snapshot.sectionIndex,
            progress_fraction: snapshot.progressFraction,
            chapter_label: snapshot.chapterLabel,
          });
          const markerIndex = this.markers.findIndex(
            (marker) => String(marker.id) === String(payload.marker.id)
          );
          if (markerIndex >= 0) {
            this.markers[markerIndex] = payload.marker;
          } else {
            this.markers.push(payload.marker);
          }
          this.sortMarkers();
        }
        this.render();
        this.setStatus(this.text("reader_marker_added", "Bookmark added."));
      } catch (error) {
        console.error("Reader marker add failed.", error);
        const message =
          error.code === "marker_limit_reached"
            ? this.text("reader_marker_limit", "Up to 100 bookmarks per book.")
            : this.text("reader_marker_error", "Unable to save this bookmark.");
        this.setStatus(message, true);
      } finally {
        this.busy = false;
        this.updateAddButton();
      }
    }

    async updateLabel(marker, customLabel) {
      if (this.busy) return false;
      this.busy = true;
      try {
        let updatedMarker;
        if (this.options.isGuest) {
          updatedMarker = { ...marker, customLabel: customLabel || null };
          const markerIndex = this.markers.findIndex(
            (candidate) => String(candidate.id) === String(marker.id)
          );
          const nextMarkers = [...this.markers];
          if (markerIndex >= 0) nextMarkers[markerIndex] = updatedMarker;
          this.writeLocalMarkers(nextMarkers);
          this.markers = nextMarkers;
        } else {
          const payload = await this.requestServer("markerUpdate", {
            marker_id: marker.id,
            custom_label: customLabel,
          });
          updatedMarker = payload.marker;
          const markerIndex = this.markers.findIndex(
            (candidate) => String(candidate.id) === String(marker.id)
          );
          if (markerIndex >= 0) this.markers[markerIndex] = updatedMarker;
        }
        this.render();
        this.setStatus(this.text("reader_marker_updated", "Bookmark updated."));
        return true;
      } catch (error) {
        console.error("Reader marker update failed.", error);
        this.setStatus(this.text("reader_marker_error", "Unable to update this bookmark."), true);
        return false;
      } finally {
        this.busy = false;
        this.updateAddButton();
      }
    }

    async deleteMarker(marker) {
      if (this.busy) return;
      this.busy = true;
      const deletedIndex = this.markers.findIndex(
        (candidate) => String(candidate.id) === String(marker.id)
      );
      try {
        if (this.options.isGuest) {
          const nextMarkers = this.markers.filter(
            (candidate) => String(candidate.id) !== String(marker.id)
          );
          this.writeLocalMarkers(nextMarkers);
          this.markers = nextMarkers;
        } else {
          await this.requestServer("markerDelete", { marker_id: marker.id });
          this.markers = this.markers.filter(
            (candidate) => String(candidate.id) !== String(marker.id)
          );
        }
        this.render();
        const focusMarker =
          this.markers[Math.min(Math.max(0, deletedIndex), this.markers.length - 1)];
        if (focusMarker) {
          this.focusMarkerRow(focusMarker, false);
        } else {
          this.element(this.options.addButtonId)?.focus();
        }
        this.setStatus(this.text("reader_marker_deleted", "Bookmark deleted."));
      } catch (error) {
        console.error("Reader marker delete failed.", error);
        this.setStatus(this.text("reader_marker_error", "Unable to delete this bookmark."), true);
      } finally {
        this.busy = false;
        this.updateAddButton();
      }
    }

    updateAddButton() {
      const addButton = this.element(this.options.addButtonId);
      if (addButton) {
        addButton.disabled = this.busy || this.markers.length >= MARKER_LIMIT;
      }
    }

    markerDisplayName(marker, index) {
      const customLabel = String(marker.customLabel || "").trim();
      return customLabel || `${this.text("reader_marker_default", "Bookmark")} ${index + 1}`;
    }

    markerPosition(marker) {
      if (typeof this.options.formatPosition === "function") {
        return this.options.formatPosition(marker);
      }
      if (marker.pageNumber) {
        return this.text("reader_marker_page", "Page %s").replace("%s", marker.pageNumber);
      }
      return "";
    }

    async navigateMarker(marker) {
      try {
        const result = await this.options.navigate?.(marker);
        if (result === false) {
          this.setStatus(
            this.text("reader_marker_error", "Unable to open this bookmark."),
            true
          );
        }
      } catch (error) {
        console.error("Reader marker navigation failed.", error);
        this.setStatus(
          this.text("reader_marker_error", "Unable to open this bookmark."),
          true
        );
      }
    }

    createActionButton(label, className, handler) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.textContent = label;
      button.addEventListener("click", handler);
      return button;
    }

    startInlineEdit(row, marker, currentName) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "reader-marker-name-input";
      input.maxLength = 120;
      input.value = marker.customLabel || "";
      input.placeholder = this.text(
        "reader_marker_name_placeholder",
        "Bookmark name (optional)"
      );
      input.setAttribute("aria-label", input.placeholder);

      const editActions = document.createElement("span");
      editActions.className = "reader-marker-edit-actions";
      let finished = false;
      const cancel = () => {
        if (finished) return;
        finished = true;
        this.render();
      };
      const save = async () => {
        if (finished) return;
        finished = true;
        const saved = await this.updateLabel(marker, input.value.trim());
        if (!saved) {
          finished = false;
          input.focus();
        }
      };

      editActions.append(
        this.createActionButton(
          this.text("reader_marker_save", "Save"),
          "reader-marker-action reader-marker-save",
          () => void save()
        ),
        this.createActionButton(
          this.text("reader_marker_cancel", "Cancel"),
          "reader-marker-action",
          cancel
        )
      );

      row.classList.add("reader-marker-row-editing");
      row.replaceChildren(input, editActions);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void save();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      });
      input.setAttribute("data-original-name", currentName);
      input.focus();
      input.select();
    }

    render() {
      this.sortMarkers();
      const list = this.element(this.options.listId);
      if (!list) {
        this.renderRail();
        return;
      }
      list.replaceChildren();

      if (this.markers.length === 0) {
        const empty = document.createElement("div");
        empty.className = "reader-marker-empty";
        empty.textContent = this.text("reader_marker_empty", "No bookmarks.");
        list.appendChild(empty);
      } else {
        this.markers.forEach((marker, index) => {
          const row = document.createElement("div");
          row.className = "reader-marker-row";
          row.dataset.markerId = String(marker.id);

          const moveButton = document.createElement("button");
          moveButton.type = "button";
          moveButton.className = "reader-marker-main";
          const markerIcon = createBookmarkIcon();
          const text = document.createElement("span");
          text.className = "reader-marker-text";
          const name = document.createElement("span");
          name.className = "reader-marker-name";
          name.textContent = this.markerDisplayName(marker, index);
          const position = document.createElement("span");
          position.className = "reader-marker-position";
          position.textContent = this.markerPosition(marker);
          text.append(name, position);
          moveButton.append(markerIcon, text);
          moveButton.addEventListener("click", () => {
            void this.navigateMarker(marker);
          });

          const actions = document.createElement("span");
          actions.className = "reader-marker-actions";
          const editButton = this.createActionButton(
            this.text("reader_marker_edit", "Edit"),
            "reader-marker-action",
            () => this.startInlineEdit(row, marker, name.textContent)
          );
          editButton.setAttribute(
            "aria-label",
            `${this.text("reader_marker_edit", "Edit")} ${name.textContent}`
          );
          const deleteButton = this.createActionButton(
            this.text("reader_marker_delete", "Delete"),
            "reader-marker-action reader-marker-delete",
            () => void this.deleteMarker(marker)
          );
          deleteButton.setAttribute(
            "aria-label",
            `${this.text("reader_marker_delete", "Delete")} ${name.textContent}`
          );
          actions.append(editButton, deleteButton);
          row.append(moveButton, actions);
          list.appendChild(row);
        });
      }

      this.updateAddButton();
      this.renderRail();
    }

    markerSliderFraction(marker, slider, useCenterPosition) {
      if (useCenterPosition) {
        return 0.5;
      }
      if (!slider) {
        return normalizedFraction(marker);
      }

      const min = Number(slider.min);
      const max = Number(slider.max);
      let value = this.options.getMarkerSliderValue?.(marker, { min, max });
      if (optionalFiniteNumber(value) === null) {
        value = marker.pageNumber;
      }
      if (optionalFiniteNumber(value) !== null) {
        return rangeValueFraction(value, min, max);
      }
      return normalizedFraction(marker);
    }

    sliderThumbSize(slider, sliderWidth) {
      const configuredSize =
        typeof global.getComputedStyle === "function"
          ? Number.parseFloat(
              global
                .getComputedStyle(slider)
                .getPropertyValue("--reader-slider-thumb-size")
            )
          : Number.NaN;
      return clamp(
        Number.isFinite(configuredSize)
          ? configuredSize
          : DEFAULT_SLIDER_THUMB_SIZE_PX,
        0,
        sliderWidth
      );
    }

    markerClusters(
      sliderWidth,
      useCenterPosition,
      slider = null,
      thumbSize = 0
    ) {
      const clusters = [];
      for (const marker of this.markers) {
        const fraction = this.markerSliderFraction(
          marker,
          slider,
          useCenterPosition
        );
        const x = rangeThumbCenterX(fraction, sliderWidth, thumbSize);
        const lastCluster = clusters[clusters.length - 1];
        if (
          lastCluster &&
          Math.abs(x - lastCluster.x) <= CLUSTER_DISTANCE_PX
        ) {
          lastCluster.markers.push(marker);
          lastCluster.fraction =
            lastCluster.markers.reduce(
              (sum, candidate) =>
                sum +
                this.markerSliderFraction(
                  candidate,
                  slider,
                  useCenterPosition
                ),
              0
            ) / lastCluster.markers.length;
          lastCluster.x = rangeThumbCenterX(
            lastCluster.fraction,
            sliderWidth,
            thumbSize
          );
        } else {
          clusters.push({ fraction, x, markers: [marker] });
        }
      }
      return clusters;
    }

    focusMarkerRow(marker, smooth = true) {
      const list = this.element(this.options.listId);
      const row = Array.from(list?.querySelectorAll("[data-marker-id]") || []).find(
        (candidate) => candidate.dataset.markerId === String(marker.id)
      );
      if (row) {
        row.scrollIntoView({
          block: "nearest",
          behavior: smooth ? "smooth" : "auto",
        });
        row.querySelector("button")?.focus({ preventScroll: true });
      }
    }

    focusCluster(cluster) {
      this.focusMarkerRow(cluster.markers[0]);
    }

    renderRail() {
      const rail = this.element(this.options.railId);
      const slider = this.element(this.options.sliderId);
      if (!rail || !slider) return;
      rail.replaceChildren();

      const sliderWidth = Math.max(1, slider.getBoundingClientRect().width);
      const thumbSize = this.sliderThumbSize(slider, sliderWidth);
      const rtl = Boolean(this.options.isRtl?.());
      const sliderMin = Number(slider.min);
      const sliderMax = Number(slider.max);
      const useCenterPosition =
        Number.isFinite(sliderMin) &&
        Number.isFinite(sliderMax) &&
        sliderMax <= sliderMin;
      for (const cluster of this.markerClusters(
        sliderWidth,
        useCenterPosition,
        slider,
        thumbSize
      )) {
        const tick = document.createElement("button");
        tick.type = "button";
        tick.className = "reader-marker-tick";
        const logicalFraction = rtl ? 1 - cluster.fraction : cluster.fraction;
        const x = rangeThumbCenterX(
          logicalFraction,
          sliderWidth,
          thumbSize
        );
        tick.style.left = `${x}px`;

        if (cluster.markers.length === 1) {
          const marker = cluster.markers[0];
          const markerIndex = this.markers.indexOf(marker);
          tick.setAttribute(
            "aria-label",
            `${this.markerDisplayName(marker, markerIndex)} ${this.markerPosition(marker)}`
          );
          tick.addEventListener("click", () => {
            void this.navigateMarker(marker);
          });
        } else {
          tick.classList.add("reader-marker-tick-cluster");
          tick.dataset.count = String(cluster.markers.length);
          tick.setAttribute(
            "aria-label",
            this.text("reader_marker_cluster", "%s bookmarks").replace(
              "%s",
              cluster.markers.length
            )
          );
          tick.addEventListener("click", () => this.focusCluster(cluster));
        }
        rail.appendChild(tick);
      }
    }
  }

  global.ComistreamReaderMarkers = {
    create(options) {
      return new ReaderMarkerManager(options);
    },
    mergePageJumpStops,
    findAdjacentPageStop,
    findAdjacentMarker,
    rangeValueFraction,
    rangeThumbCenterX,
    limit: MARKER_LIMIT,
  };
})(window);
