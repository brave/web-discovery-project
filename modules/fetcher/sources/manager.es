import { fetch } from "../core/http";
import pacemaker, { ONE_SECOND, ONE_MINUTE } from "../core/services/pacemaker";
import config from "../core/config";

export default class Manager {
  constructor(webDiscoveryProject) {
    this.webDiscoveryProject = webDiscoveryProject;
    this.timeout = null;
    this.nextFetch = ONE_MINUTE;
  }

  async _doFetch() {
    const getJobResponse = await fetch(
      `${config.settings.FETCHER_GATEWAY}/v1/get_job`,
    );

    if (getJobResponse.status !== 200) {
      console.error("Abort!", getJobResponse.status);
      this._scheduleNextFetch();
      return;
    }

    // Example of valid job:
    // {
    //   url,
    //   headers,
    //   job_id,
    //   status: "ok",
    //   next_attempt_seconds,
    // }
    //
    // Example of response with no available job:
    // {
    //   status: "no job",
    //   next_attempt_seconds,
    // }
    const { status, next_attempt_seconds, url, headers, job_id } =
      await getJobResponse.json();

    this.nextFetch = next_attempt_seconds * ONE_SECOND;

    // Could not fetch job
    if (status !== "ok") {
      console.error("Could not fetch job:", status);
      this._scheduleNextFetch();
      return;
    }

    const t0 = Date.now();
    const fetchResponse = await this.webDiscoveryProject.action(
      "anonymousHttpGet",
      url,
      headers,
    );
    const t1 = Date.now();
    console.error("RESPONSE", fetchResponse);

    const pushJobResponse = await fetch(
      `${config.settings.FETCHER_GATEWAY}/v1/push_job`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          job_id,
          url,
          resource_url: fetchResponse.url,
          html: fetchResponse.body,
          request_headers: headers,
          response_headers: fetchResponse.headers,
          status_code: fetchResponse.status,
          fetch_timestamp: Date.now(),
          fetch_duration_ms: t1 - t0,
        }),
      },
    );

    console.error("Response from gateway", await pushJobResponse.json());

    this._scheduleNextFetch();
  }

  _scheduleNextFetch() {
    console.error("Scheduling next fetch in", this.nextFetch, "ms");
    this.timeout = pacemaker.setTimeout(async () => {
      try {
        await this._doFetch();
      } catch (ex) {
        console.error("Error while trying to fetch", ex);
        this._scheduleNextFetch();
      }
    }, this.nextFetch);
  }

  init() {
    this._scheduleNextFetch();
  }

  unload() {
    if (this.timeout) {
      pacemaker.clearTimeout(this.timeout);
      this.timeout = null;
    }
  }
}
