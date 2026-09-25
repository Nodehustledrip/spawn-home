"use strict";
const cluster = require("cluster");
const path = require("path");
const max = Math.max(1, Math.min(32, parseInt(process.env.FORGE_AUTOSCALE_MAX || "1", 10) || 1));
const isPrimary = typeof cluster.isPrimary === "boolean" ? cluster.isPrimary : cluster.isMaster;
function killWorkers(){ const w=cluster.workers||{}; Object.keys(w).forEach(function(id){ try{ w[id].process.kill("SIGTERM"); }catch(_){} }); }
if (isPrimary) {
  console.log("[forge-autoscale] primary pid=" + process.pid + " workers=" + max + " vCPU=" + (process.env.FORGE_AUTOSCALE_VCPU||"?") + " RAM=" + (process.env.FORGE_AUTOSCALE_RAM||"?") + "GiB");
  var shuttingDown = false;
  for (let i = 0; i < max; i++) cluster.fork();
  cluster.on("exit", function (worker) { if (shuttingDown) return; console.log("[forge-autoscale] worker " + worker.process.pid + " exited — respawning"); cluster.fork(); });
  function shutdown(){ if(shuttingDown)return; shuttingDown=true; console.log("[forge-autoscale] shutting down workers"); killWorkers(); setTimeout(function(){ process.exit(0); }, 400); }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
} else {
  console.log("[forge-autoscale] worker pid=" + process.pid);
  require(path.join(__dirname, "server.js"));
}
