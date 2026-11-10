import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import "./contrast.css";
import App from "./App";
const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
class StartupBoundary extends React.Component<React.PropsWithChildren, {failed:boolean}> {
  state = {failed:false};
  static getDerivedStateFromError() { return {failed:true}; }
  render() {
    if (this.state.failed) return <div className="startup-error" role="alert"><h1>Riften couldn’t open this view.</h1><p>Reload the workspace to try again. Your saved records are still on the server.</p><button onClick={() => window.location.reload()}>Reload workspace</button></div>;
    return this.props.children;
  }
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StartupBoundary>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
    </StartupBoundary>
  </React.StrictMode>,
);
