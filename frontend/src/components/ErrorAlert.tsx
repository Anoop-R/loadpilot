/**
 * ErrorAlert — user-friendly error display with an expandable technical detail.
 *
 * Non-technical users see a plain-English explanation of what went wrong and
 * what to do next. A small "⚙ Details" button reveals the raw technical error
 * so developers can debug without polluting the main message.
 *
 * The plain-English mapping covers all known error patterns from the app.
 * Unknown errors fall back to a generic "something went wrong" message.
 */

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface FriendlyError {
  heading: string;       // short headline, e.g. "Couldn't connect to the AI"
  what: string;          // what happened in plain English
  action?: string;       // what the user should do
}

function classify(raw: string): FriendlyError {
  const msg = raw.toLowerCase();

  // Network / server unreachable
  if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("load failed")) {
    return {
      heading: "Can't reach the server",
      what: "Your browser couldn't connect to the LoadPilot backend. The server may not be running, or there's a network issue.",
      action: "Check that the server is still running (look for 'LoadPilot running on :4000' in the terminal). If it stopped, run npm start again.",
    };
  }

  // Groq / AI key missing or invalid
  if (msg.includes("groq_api_key") || msg.includes("groq api key") || msg.includes("401") && msg.includes("groq")) {
    return {
      heading: "AI key not configured",
      what: "The Groq API key is missing or invalid, so AI features aren't available right now.",
      action: "Open backend\\.env and make sure GROQ_API_KEY is set to a valid key from console.groq.com.",
    };
  }

  // Groq rate limit
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many requests")) {
    return {
      heading: "AI is busy — too many requests",
      what: "The AI service is temporarily rate-limited because too many requests were sent too quickly.",
      action: "Wait 10–20 seconds and try again. If this keeps happening, the free tier limit may be reached for this minute.",
    };
  }

  // Groq / AI response parse failure
  if (msg.includes("failed to parse") || msg.includes("unexpected token") && msg.includes("json")) {
    return {
      heading: "Unexpected response from AI",
      what: "The AI returned a response in an unexpected format. This sometimes happens with complex requests.",
      action: "Try rephrasing your input and submitting again. If it keeps failing, the AI model may be having a temporary issue.",
    };
  }

  // HTML response where JSON expected (route not found, server not restarted)
  if (msg.includes("<!doctype") || msg.includes("unexpected token '<'") || msg.includes("is not valid json")) {
    return {
      heading: "Server returned an unexpected response",
      what: "The server sent back a web page instead of data. This usually means the server wasn't restarted after an update, or the requested feature isn't available in the running version.",
      action: "Stop the server (Ctrl+C in the terminal) and run npm start again to pick up the latest changes.",
    };
  }

  // MongoDB / database
  if (msg.includes("mongodb") || msg.includes("atlas") || msg.includes("ssl") || msg.includes("tls")) {
    return {
      heading: "Database connection issue",
      what: "LoadPilot couldn't connect to the MongoDB database. Everything still works — run history and configs are saved to local files instead.",
      action: "If you need the database, check that NODE_OPTIONS=--openssl-legacy-provider is set as a system environment variable, then restart the server.",
    };
  }

  // JMeter not found
  if (msg.includes("jmeter") && (msg.includes("not found") || msg.includes("command") || msg.includes("enoent"))) {
    return {
      heading: "JMeter not found",
      what: "The server couldn't find JMeter on this machine, so the test can't be run directly from LoadPilot.",
      action: "Make sure JMeter is installed and its bin folder is added to your system PATH. Check the setup guide for instructions.",
    };
  }

  // File upload too large
  if (msg.includes("too large") || msg.includes("payload too") || msg.includes("413")) {
    return {
      heading: "File is too large",
      what: "The file you tried to upload is larger than the 10MB limit.",
      action: "Try splitting it into a smaller file or reducing the number of rows.",
    };
  }

  // Auth
  if (msg.includes("unauthorized") || msg.includes("invalid credentials") || msg.includes("sign in")) {
    return {
      heading: "Sign-in failed",
      what: "The username or password wasn't recognised.",
      action: "Double-check your username and password and try again.",
    };
  }

  // Timeout
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return {
      heading: "Request took too long",
      what: "The operation didn't complete in time. This sometimes happens with large test files or slow AI responses.",
      action: "Try again in a moment. If it keeps timing out with large files, try a smaller input.",
    };
  }

  // Generic fallback
  return {
    heading: "Something went wrong",
    what: "An unexpected error occurred. The technical details below may help identify the cause.",
    action: "Try the action again. If it keeps failing, check the terminal running the server for more detail.",
  };
}

interface ErrorAlertProps {
  error: string;
  style?: React.CSSProperties;
}

export default function ErrorAlert({ error, style }: ErrorAlertProps) {
  const [showDetail, setShowDetail] = useState(false);
  const friendly = classify(error);

  return (
    <div className="error-alert" style={style}>
      <div className="error-alert-main">
        <div className="error-alert-content">
          <div className="error-alert-heading">⚠ {friendly.heading}</div>
          <div className="error-alert-what">{friendly.what}</div>
          {friendly.action && (
            <div className="error-alert-action">{friendly.action}</div>
          )}
        </div>
        <button
          className="error-alert-toggle"
          onClick={() => setShowDetail(v => !v)}
          title={showDetail ? "Hide technical details" : "Show technical details"}
          type="button"
        >
          {showDetail ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          <span>{showDetail ? "Hide" : "Details"}</span>
        </button>
      </div>
      {showDetail && (
        <pre className="error-alert-detail">{error}</pre>
      )}
    </div>
  );
}
