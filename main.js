'use strict';

const obsidian = require('obsidian');
const {
  Plugin,
  PluginSettingTab,
  Setting,
  MarkdownRenderer,
  MarkdownView,
  WorkspaceLeaf,
  Component,
  setIcon,
  parseYaml,
  parseLinktext,
} = obsidian;

const DEFAULT_SETTINGS = {
  trigger: 'click', // 'click' = plain click peeks, 'alt-click' = Alt+click peeks
  widthPx: 900,
  showProperties: true,
  closeOnBackdrop: true,
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

class PeekView extends Component {
  constructor(plugin) {
    super();
    this.plugin = plugin;
    this.app = plugin.app;
    this.stack = [];
    this.editing = false;
    this.bodyComp = null;
    this.token = 0;
    this.flushSave = null;
    this.liveLeaf = null;
  }

  async disposeLive() {
    const leaf = this.liveLeaf;
    if (!leaf) return;
    this.liveLeaf = null;
    this.scrollEl?.removeClass('is-live');
    try {
      await leaf.view?.save?.();
    } catch (e) {
      /* ignore */
    }
    try {
      leaf.detach();
    } catch (e) {
      /* ignore */
    }
    leaf.containerEl?.remove?.();
  }

  async renderLiveEditor(file, token) {
    let leaf = null;
    try {
      leaf = new WorkspaceLeaf(this.app);
      // mode 'source' with source:false is Live Preview
      await leaf.openFile(file, { state: { mode: 'source', source: false }, active: false });
      if (token !== this.token) {
        try {
          leaf.detach();
        } catch (e) {
          /* ignore */
        }
        return true;
      }
      const host = this.contentEl.createDiv({ cls: 'wlp-live' });
      host.appendChild(leaf.containerEl);
      this.liveLeaf = leaf;
      this.scrollEl.addClass('is-live');
      setTimeout(() => leaf.view?.editor?.focus?.(), 50);
      return true;
    } catch (e) {
      console.error('Wikilink Peek: live preview editor failed, falling back to textarea', e);
      try {
        leaf?.detach();
      } catch (e2) {
        /* ignore */
      }
      return false;
    }
  }

  get current() {
    return this.stack[this.stack.length - 1];
  }

  onload() {
    this.overlayEl = document.body.createDiv({ cls: 'wlp-overlay' });
    this.register(() => this.overlayEl.remove());

    this.panelEl = this.overlayEl.createDiv({ cls: 'wlp-panel' });
    this.applyWidth();

    const bar = this.panelEl.createDiv({ cls: 'wlp-toolbar' });
    this.backBtn = this.makeBtn(bar, 'arrow-left', 'Back', () => this.back());
    this.crumbEl = bar.createDiv({ cls: 'wlp-crumb' });
    bar.createDiv({ cls: 'wlp-spacer' });
    this.editBtn = this.makeBtn(bar, 'pencil', 'Edit', () => this.toggleEdit());
    this.makeBtn(bar, 'maximize-2', 'Open in new tab', () => this.openElsewhere('tab'));
    this.makeBtn(bar, 'separator-vertical', 'Open to the right', () => this.openElsewhere('split'));
    this.makeBtn(bar, 'x', 'Close (Esc)', () => this.close());

    this.scrollEl = this.panelEl.createDiv({ cls: 'wlp-scroll' });
    this.contentEl = this.scrollEl.createDiv({ cls: 'wlp-content' });

    this.registerDomEvent(this.overlayEl, 'mousedown', (e) => {
      if (e.target === this.overlayEl && this.plugin.settings.closeOnBackdrop) this.close();
    });
    this.registerDomEvent(
      document,
      'keydown',
      (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.close();
        }
      },
      true
    );
  }

  applyWidth() {
    this.panelEl?.style.setProperty('--wlp-width', this.plugin.settings.widthPx + 'px');
  }

  makeBtn(parent, icon, label, onClick) {
    const btn = parent.createDiv({ cls: 'wlp-btn clickable-icon', attr: { 'aria-label': label } });
    setIcon(btn, icon);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  push(file, subpath) {
    const cur = this.current;
    if (cur && cur.file.path === file.path && cur.subpath === (subpath || '')) return;
    this.flushSave?.();
    this.stack.push({ file, subpath: subpath || '' });
    this.editing = false;
    this.render();
  }

  back() {
    if (this.stack.length <= 1) return;
    this.flushSave?.();
    this.stack.pop();
    this.editing = false;
    this.render();
  }

  async toggleEdit() {
    await this.flushSave?.();
    this.editing = !this.editing;
    this.render();
  }

  openElsewhere(kind) {
    const { file, subpath } = this.current;
    this.close();
    this.app.workspace.getLeaf(kind).openFile(file, subpath ? { eState: { subpath } } : undefined);
  }

  close() {
    this.flushSave?.();
    this.disposeLive();
    if (this.plugin.peek === this) this.plugin.peek = null;
    this.unload();
  }

  async render() {
    const { file, subpath } = this.current;
    const token = ++this.token;
    await this.disposeLive();
    if (token !== this.token) return;

    this.backBtn.toggleClass('is-disabled', this.stack.length <= 1);
    this.crumbEl.empty();
    if (file.parent && file.parent.path !== '/') {
      this.crumbEl.createSpan({ cls: 'wlp-crumb-folder', text: file.parent.path + ' / ' });
    }
    this.crumbEl.createSpan({ text: file.basename });
    setIcon(this.editBtn, this.editing ? 'eye' : 'pencil');
    this.editBtn.setAttr('aria-label', this.editing ? 'Preview' : 'Edit');

    this.contentEl.empty();
    this.scrollEl.scrollTop = 0;
    if (this.bodyComp) this.removeChild(this.bodyComp);
    this.bodyComp = this.addChild(new Component());

    this.contentEl.createDiv({ cls: 'wlp-title', text: file.basename });

    if (this.editing) {
      const ok = await this.renderLiveEditor(file, token);
      if (ok) return;
      const rawText = await this.app.vault.read(file);
      if (token !== this.token) return;
      this.renderEditor(file, rawText);
      return;
    }

    const raw = await this.app.vault.read(file);
    if (token !== this.token) return;

    let body = raw;
    let fm = null;
    const m = raw.match(FRONTMATTER_RE);
    if (m) {
      body = raw.slice(m[0].length);
      try {
        fm = parseYaml(m[1]);
      } catch (e) {
        fm = null;
      }
    }

    if (this.plugin.settings.showProperties && fm && typeof fm === 'object') {
      this.renderProperties(fm, file.path);
    }

    const bodyEl = this.contentEl.createDiv({ cls: 'markdown-preview-view markdown-rendered wlp-body' });
    await MarkdownRenderer.render(this.app, body, bodyEl, file.path, this.bodyComp);
    if (token !== this.token) return;

    if (subpath && subpath.startsWith('#') && !subpath.startsWith('#^')) {
      const want = subpath.slice(1).replace(/#/g, ' ').trim().toLowerCase();
      const heading = Array.from(bodyEl.querySelectorAll('h1,h2,h3,h4,h5,h6')).find(
        (h) => h.textContent.trim().toLowerCase() === want
      );
      heading?.scrollIntoView({ block: 'start' });
    }
  }

  renderProperties(fm, sourcePath) {
    const wrap = this.contentEl.createDiv({ cls: 'wlp-props' });
    for (const [key, val] of Object.entries(fm)) {
      if (key === 'position' || val === null || val === undefined || val === '') continue;
      const items = (Array.isArray(val) ? val : [val]).filter((v) => v !== null && v !== undefined && v !== '');
      if (!items.length) continue;
      const row = wrap.createDiv({ cls: 'wlp-prop' });
      row.createDiv({ cls: 'wlp-prop-key', text: key });
      const v = row.createDiv({ cls: 'wlp-prop-val' });
      for (const item of items) {
        const cell = v.createSpan({ cls: Array.isArray(val) ? 'wlp-chip' : 'wlp-text' });
        const s = typeof item === 'object' ? JSON.stringify(item) : String(item);
        MarkdownRenderer.render(this.app, s, cell, sourcePath, this.bodyComp);
      }
    }
    if (!wrap.childElementCount) wrap.remove();
  }

  renderEditor(file, raw) {
    const ta = this.contentEl.createEl('textarea', { cls: 'wlp-editor' });
    ta.value = raw;
    ta.spellcheck = false;

    const autosize = () => {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    };

    let dirty = false;
    let timer = null;
    const doSave = async () => {
      if (!dirty) return;
      dirty = false;
      await this.app.vault.modify(file, ta.value);
    };
    this.flushSave = () => {
      clearTimeout(timer);
      return doSave();
    };

    ta.addEventListener('input', () => {
      dirty = true;
      autosize();
      clearTimeout(timer);
      timer = setTimeout(doSave, 500);
    });

    requestAnimationFrame(() => {
      autosize();
      ta.focus();
    });
  }
}

module.exports = class WikilinkPeekPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.peek = null;

    this.addSettingTab(new PeekSettingTab(this.app, this));
    this.registerDomEvent(document, 'click', (e) => this.onClick(e), true);

    this.addCommand({
      id: 'close-peek',
      name: 'Close peek panel',
      callback: () => this.peek?.close(),
    });
  }

  onunload() {
    this.peek?.close();
  }

  saveSettings() {
    return this.saveData(this.settings);
  }

  openPeek(file, subpath) {
    if (!this.peek) {
      this.peek = new PeekView(this);
      this.peek.load();
    }
    this.peek.push(file, subpath);
  }

  onClick(e) {
    if (e.button !== 0 || e.defaultPrevented) return;
    const target = e.target;
    if (!(target instanceof Element)) return;

    const inPeek = !!target.closest('.wlp-panel');
    const info = this.resolveLink(e, inPeek);
    if (!info) return;

    const mod = e.ctrlKey || e.metaKey;
    if (!inPeek) {
      if (this.settings.trigger === 'click') {
        if (mod || e.shiftKey || e.altKey) return; // keep Obsidian's own modifier behaviour
      } else if (!e.altKey) {
        return;
      }
    }

    const { path, subpath } = parseLinktext(info.linktext);
    const file = path
      ? this.app.metadataCache.getFirstLinkpathDest(path, info.sourcePath)
      : this.app.vault.getAbstractFileByPath(info.sourcePath);
    // Unresolved links and non-markdown files fall through to Obsidian's default handling
    if (!file || file.extension !== 'md') return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (inPeek && mod) {
      this.peek?.close();
      this.app.workspace.getLeaf('tab').openFile(file);
      return;
    }
    this.openPeek(file, subpath);
  }

  resolveLink(e, inPeek) {
    const t = e.target;
    if (!inPeek && t.closest('.modal-container, .menu, .prompt')) return null;

    let sourcePath = '';
    if (inPeek) sourcePath = this.peek?.current?.file.path ?? '';
    else sourcePath = this.sourcePathFor(t);

    const a = t.closest('.internal-link');
    if (a) {
      const href = a.getAttribute('data-href');
      if (href) return { linktext: href, sourcePath };
    }

    if (t.closest('.cm-hmd-internal-link') && t.closest('.markdown-source-view.is-live-preview')) {
      return this.linkAtPos(e, inPeek ? this.peek?.liveLeaf?.view : null);
    }

    if (a) {
      const href = a.getAttribute('href') || a.textContent;
      if (href) return { linktext: href, sourcePath };
    }
    return null;
  }

  sourcePathFor(el) {
    let path = '';
    this.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (!path && v?.containerEl?.contains(el) && v.file) path = v.file.path;
    });
    return path || this.app.workspace.getActiveFile()?.path || '';
  }

  linkAtPos(e, knownView) {
    let view = knownView || null;
    if (!view) {
      this.app.workspace.iterateAllLeaves((leaf) => {
        if (leaf.view instanceof MarkdownView && leaf.view.containerEl.contains(e.target)) view = leaf.view;
      });
    }
    const cm = view?.editor?.cm;
    if (!view || !cm?.posAtCoords) return null;
    const pos = cm.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos === null || pos === undefined) return null;
    const links = this.app.metadataCache.getFileCache(view.file)?.links ?? [];
    const hit = links.find((l) => pos >= l.position.start.offset && pos <= l.position.end.offset);
    return hit ? { linktext: hit.link, sourcePath: view.file.path } : null;
  }
};

class PeekSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Open peek on')
      .setDesc('Plain click keeps Ctrl/Cmd+click for opening in a new tab as normal.')
      .addDropdown((d) =>
        d
          .addOption('click', 'Click')
          .addOption('alt-click', 'Alt + click')
          .setValue(this.plugin.settings.trigger)
          .onChange(async (v) => {
            this.plugin.settings.trigger = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName('Panel width').addSlider((s) =>
      s
        .setLimits(600, 1400, 50)
        .setValue(this.plugin.settings.widthPx)
        .setDynamicTooltip()
        .onChange(async (v) => {
          this.plugin.settings.widthPx = v;
          this.plugin.peek?.applyWidth();
          await this.plugin.saveSettings();
        })
    );

    new Setting(containerEl)
      .setName('Show properties')
      .setDesc('Display the note’s frontmatter as a properties table under the title.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showProperties).onChange(async (v) => {
          this.plugin.settings.showProperties = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName('Close when clicking outside').addToggle((t) =>
      t.setValue(this.plugin.settings.closeOnBackdrop).onChange(async (v) => {
        this.plugin.settings.closeOnBackdrop = v;
        await this.plugin.saveSettings();
      })
    );
  }
}