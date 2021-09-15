export const PAGE_LOADING_STATE = {
  CREATED: "created",
  NAVIGATING: "navigating",
  COMMITTED: "committed",
  LOADED: "loaded",
  COMPLETE: "complete",
};

type Frame = {
  parentFrameId: number;
  url?: string;
};

interface FirefoxWebRequestDetails extends chrome.webRequest.WebRequestDetails {
  originUrl?: string;
  documentUrl?: string;
}

export default class Page {
  id: number;
  url?: string;
  isRedirect: boolean;
  isPrivate: boolean;
  created: number;
  destroyed: number | null;
  lastRequestId: number | null;
  frames: Map<number, Frame>;
  state: string;
  activeTime: number;
  activeFrom: number;
  counter: number;

  previous?: Page;

  constructor({ id, active, url, incognito }: chrome.tabs.Tab) {
    this.id = id || 0;
    this.url = url;
    this.isRedirect = false;
    this.isPrivate = incognito;
    this.created = Date.now();
    this.destroyed = null;
    this.lastRequestId = null;
    this.frames = new Map([
      [
        0,
        {
          parentFrameId: -1,
          url,
        },
      ],
    ]);
    this.state = PAGE_LOADING_STATE.CREATED;

    this.activeTime = 0;
    this.activeFrom = active ? Date.now() : 0;

    this.counter = 0;
  }

  setActive(active: boolean) {
    if (active && this.activeFrom === 0) {
      this.activeFrom = Date.now();
    } else if (!active && this.activeFrom > 0) {
      this.activeTime += Date.now() - this.activeFrom;
      this.activeFrom = 0;
    }
  }

  updateState(newState: string) {
    this.state = newState;
  }

  stage() {
    this.setActive(false);
    this.destroyed = Date.now();
    // unset previous (to prevent history chain memory leak)
    this.previous = undefined;
  }

  /**
   * Return the URL of top-level document (i.e.: tab URL).
   */
  getTabUrl(): string | undefined {
    return this.url;
  }

  /**
   * Return the URL of the frame.
   */
  getFrameUrl(context: FirefoxWebRequestDetails): string | undefined {
    const { frameId } = context;

    const frame = this.frames.get(frameId);

    // In some cases, frame creation does not trigger a webRequest event (e.g.:
    // if the iframe is specified in the HTML of the page directly). In this
    // case we try to fall-back to something else: documentUrl, originUrl,
    // initiator.
    if (frame === undefined) {
      return context.documentUrl || context.originUrl || context.initiator;
    }

    return frame.url;
  }
}
