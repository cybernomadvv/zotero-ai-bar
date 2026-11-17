import { assert } from 'chai';
import { config } from '../package.json';
import { formatPopupActionLabel, registerReaderInitializer, unregisterReaderInitializer } from '../src/modules/readerBarPopup';
import { getPaperTranslation, type PaperHandle } from '../src/modules/paperTranslation';

describe('readerBarPopup', function () {
  it('formats localized quick actions with locale-appropriate brackets', function () {
    assert.equal(formatPopupActionLabel('解释', 'zh-CN'), '【解释】');
    assert.equal(formatPopupActionLabel('Explain', 'en-US'), '[Explain]');
  });

  describe('auto translation', function () {
    // The test sandbox provides the plugin globals at runtime.
    const scope = globalThis as typeof globalThis & { addon: typeof addon; ztoolkit: typeof ztoolkit };
    let originalGlobals: Pick<typeof scope, 'addon' | 'ztoolkit'>;
    let originalHandler: typeof addon.data._readerPopupHandler;
    let originalSelection: typeof addon.data.selection;
    let originalSend: typeof addon.chatManager.sendTranslationRequest;
    let host: HTMLElement;
    type SelectionPosition = { pageIndex: number; rects: number[][] };
    let reader: { itemID: number; tabID: string; _internalReader: { _type: 'pdf'; getSelectionPosition: () => SelectionPosition | null } };
    let position: SelectionPosition | null;
    let requests: Parameters<typeof addon.chatManager.sendTranslationRequest>[0][];
    let item: Zotero.Item;
    let handle: PaperHandle;
    const prefs = ['translate.enableAuto', 'extend-selection-context', 'translate.extendContext', 'translate.targetLanguage'];
    let originalPrefs: unknown[];

    before(function () {
      originalGlobals = { addon: scope.addon, ztoolkit: scope.ztoolkit };
      // Zotero registers this plugin instance dynamically during startup.
      const installed = Zotero as typeof Zotero & { ZAIBar: typeof addon };
      scope.addon = installed.ZAIBar;
      scope.ztoolkit = scope.addon.data.ztoolkit;
    });

    after(function () {
      scope.addon = originalGlobals.addon;
      scope.ztoolkit = originalGlobals.ztoolkit;
    });

    beforeEach(async function () {
      originalHandler = addon.data._readerPopupHandler;
      if (originalHandler) Zotero.Reader.unregisterEventListener('renderTextSelectionPopup', originalHandler);
      originalSelection = addon.data.selection;
      addon.data.selection = {};
      originalSend = addon.chatManager.sendTranslationRequest;
      requests = [];
      addon.chatManager.sendTranslationRequest = async (request) => {
        requests.push(request);
      };
      originalPrefs = prefs.map((pref) => Zotero.Prefs.get(`${config.prefsPrefix}.${pref}`, true));
      for (const [index, value] of [true, false, 'never', 'zh-CN'].entries()) {
        Zotero.Prefs.set(`${config.prefsPrefix}.${prefs[index]}`, value, true);
      }
      item = new Zotero.Item('journalArticle');
      item.setField('title', 'Isolated floating translation fixture');
      await item.saveTx();
      handle = await getPaperTranslation(item.id, 'zh-CN');
      await IOUtils.makeDirectory(handle.dir, { ignoreExisting: true });
      await IOUtils.writeJSON(PathUtils.join(handle.dir, 'translation.json'), {
        version: 1,
        target: 'zh-CN',
        segments: [
          { id: 0, source: 'Selected text', translation: '已译选区' },
          { id: 1, source: 'First selection', translation: '第一段译文' },
          { id: 2, source: 'Second selection', translation: '第二段译文' },
        ],
        terms: [],
        overrides: {},
        fullTranslation: '已译选区。第一段译文。第二段译文。',
      });
      handle.state.translated = true;
      handle.state.status = 'complete';
      const doc = Zotero.getMainWindow().document;
      host = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
      doc.documentElement!.appendChild(host);
      position = { pageIndex: 0, rects: [[10, 10, 100, 20]] };
      reader = { itemID: item.id, tabID: `auto-translation-${item.id}`, _internalReader: { _type: 'pdf', getSelectionPosition: () => position } };
      registerReaderInitializer();
    });

    afterEach(async function () {
      unregisterReaderInitializer();
      host?.remove();
      addon.data.selection = originalSelection;
      addon.chatManager.sendTranslationRequest = originalSend;
      prefs.forEach((pref, index) => {
        const name = `${config.prefsPrefix}.${pref}`;
        const value = originalPrefs[index];
        if (value === undefined) Zotero.Prefs.clear(name, true);
        else Zotero.Prefs.set(name, value as string | boolean, true);
      });
      addon.data._readerPopupHandler = originalHandler;
      if (originalHandler) Zotero.Reader.registerEventListener('renderTextSelectionPopup', originalHandler, config.addonID);
      if (item?.id) await item.eraseTx();
      if (handle) await IOUtils.remove(handle.dir, { recursive: true });
    });

    function render(text = 'Selected text', annotationPosition = position) {
      host.replaceChildren();
      // The fixture supplies only reader members used by this popup handler.
      const event = {
        reader,
        doc: host.ownerDocument,
        params: { annotation: { text, position: annotationPosition } },
        append: (fragment: Node) => host.appendChild(fragment),
      } as unknown as Parameters<NonNullable<typeof addon.data._readerPopupHandler>>[0];
      addon.data._readerPopupHandler!(event);
    }

    async function waitForText(expected: string) {
      for (let attempt = 0; attempt < 100 && host.querySelector('.floating-translation-body')?.textContent !== expected; attempt++) {
        await Zotero.Promise.delay(10);
      }
      assert.equal(host.querySelector('.floating-translation-body')?.textContent, expected);
      assert.isEmpty(requests, 'automatic translation must stay out of the chat host');
    }

    it('shows a cached translation across repeated popup renders without opening chat', async function () {
      render();
      render();
      await waitForText('已译选区');
      render();
      await waitForText('已译选区');
    });

    it('discards stale annotation text when cancellation renders the popup', async function () {
      render();
      await waitForText('已译选区');
      const oldPosition = position;
      position = null;
      render('Selected text', oldPosition);
      assert.isNull(host.querySelector('.floating-translation'));
      assert.isUndefined(addon.data.selection.text);
      assert.isUndefined(addon.data.selection.currentAnnotation);
    });

    it('clears shared selection context when the reader closes a selection between renders', async function () {
      render();
      position = null;
      await Zotero.Promise.delay(450);
      assert.isUndefined(addon.data.selection.text);
      assert.isUndefined(addon.data.selection.currentAnnotation);
      assert.isEmpty(requests);
    });

    it('clears shared context when the selection popup is removed', async function () {
      render();
      position = null;
      host.replaceChildren();
      await Zotero.Promise.delay(450);
      assert.isUndefined(addon.data.selection.text);
      assert.isEmpty(requests);
    });

    it('shows the translation for the same text at a new document position', async function () {
      render();
      await waitForText('已译选区');
      position = { pageIndex: 1, rects: [[10, 10, 100, 20]] };
      render();
      await waitForText('已译选区');
    });

    it('allows selecting the same passage again after clearing it', async function () {
      render();
      await waitForText('已译选区');
      const oldPosition = position;
      position = null;
      render('Selected text', oldPosition);
      position = oldPosition;
      render();
      await waitForText('已译选区');
    });

    it('shows only the newest selection when it changes before translation starts', async function () {
      render('First selection');
      render('Second selection');
      await waitForText('第二段译文');
      assert.notInclude(host.textContent, '第一段译文');
    });

    it('respects disabled auto translation and empty selections', async function () {
      Zotero.Prefs.set(`${config.prefsPrefix}.translate.enableAuto`, false, true);
      render();
      assert.isNull(host.querySelector('.floating-translation'));
      Zotero.Prefs.set(`${config.prefsPrefix}.translate.enableAuto`, true, true);
      render('  ');
      assert.isNull(host.querySelector('.floating-translation'));
      assert.isEmpty(requests);
    });
  });
});
