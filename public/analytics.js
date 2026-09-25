(function () {
  "use strict";

  /* ——— PostHog (US cloud) ——— */
  var POSTHOG_KEY = "phc_nqATxCRsk9kKbZCNF3LHqdGzQYK97WzTn8n7Ntmi8QzJ";
  var POSTHOG_HOST = "https://us.i.posthog.com";

  !(function (t, e) {
    var o, n, p, r;
    e.__SV ||
      ((window.posthog = e),
      (e._i = []),
      (e.init = function (i, s, a) {
        function g(t, e) {
          var o = e.split(".");
          2 == o.length && ((t = t[o[0]]), (e = o[1]));
          t[e] = function () {
            t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
          };
        }
        (p = t.createElement("script")).type = "text/javascript";
        p.crossOrigin = "anonymous";
        p.async = !0;
        p.src =
          s.api_host.replace(".i.posthog.com", "-assets.i.posthog.com") +
          "/static/array.js";
        (r = t.getElementsByTagName("script")[0]).parentNode.insertBefore(p, r);
        var u = e;
        void 0 !== a ? (u = e[a] = []) : (a = "posthog");
        u.people = u.people || [];
        Object.defineProperty(u, "toString", {
          configurable: !0,
          enumerable: !0,
          writable: !0,
          value: function (t) {
            var e = "posthog";
            return "posthog" !== a && (e += "." + a), t || (e += " (stub)"), e;
          },
        });
        Object.defineProperty(u.people, "toString", {
          configurable: !0,
          enumerable: !0,
          writable: !0,
          value: function () {
            return u.toString(1) + ".people (stub)";
          },
        });
        o =
          "init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(
            " "
          );
        for (n = 0; n < o.length; n++) g(u, o[n]);
        e._i.push([i, s, a]);
      }),
      (e.__SV = 1));
  })(document, window.posthog || []);

  try {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      ui_host: "https://us.posthog.com",
      defaults: "2026-05-30",
      person_profiles: "identified_only",
      capture_pageview: true,
      capture_pageleave: true,
    });
  } catch (_) { /* ignore */ }

  window.spawnTrack = function (event, props) {
    try {
      if (window.posthog && typeof window.posthog.capture === "function") {
        window.posthog.capture(event, props || {});
      }
    } catch (_) { /* ignore */ }
  };

  /* ——— Sentry browser SDK ——— */
  var SENTRY_DSN =
    "https://67a9dc4f4214821866acfa0bbac449c4@o4512147120848896.ingest.us.sentry.io/4512147133104128";

  function loadSentry() {
    var s = document.createElement("script");
    s.src = "https://browser.sentry-cdn.com/8.55.0/bundle.tracing.min.js";
    s.crossOrigin = "anonymous";
    s.onload = function () {
      try {
        if (window.Sentry) {
          window.Sentry.init({
            dsn: SENTRY_DSN,
            environment: "production",
            tracesSampleRate: 0.1,
            integrations: [],
          });
        }
      } catch (_) { /* ignore */ }
    };
    document.head.appendChild(s);
  }

  try {
    loadSentry();
  } catch (_) { /* ignore */ }
})();
