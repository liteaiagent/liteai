# Quickstart Guide: prompt-tray-redesign

## Overview
This redesign provides enhanced granular controls over your conversation interactions directly within the prompt input tray. By decoupling agent identities from tool constraints, you can now seamlessly dictate how strategies are executed.

## Key Changes

1. **Agent Specificity**
   - Click the "LiteAI" dropdown (formerly "Build/Plan").
   - You can assign distinct personas like "security-auditor" to lead conversations.
   - The "Plan" pseudo-agent no longer crowds this root selection.

2. **Quick Iteration (Fast vs Plan Mode)**
   - Toggle the Tool Profile parameter to the **"Fast"** preset.
   - Any complex task submission will now be directly executed, skipping approval roadblocks usually handled by the Plan proxy. Ideal for straightforward or repetitive code generation.

3. **Performance Tweaking (Fork)**
   - Turn **Fork Enabled** on to dramatically reduce inference costs and parallelize context caching using subagents. 
   - Note: Coordinator layouts will forcibly disable Fork functionality.

4. **Future Discoverability**
   - See how Swarm workflows will look once released by monitoring the Session Mode selector!
