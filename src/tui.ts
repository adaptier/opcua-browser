import blessed from 'blessed';
import { OPCUAClient, BrowseDirection, NodeClass, AttributeIds, DataType, ClientSubscription, TimestampsToReturn, ClientMonitoredItem, DataValue, Variant } from 'node-opcua';

interface NodeInfo {
  name: string;
  nodeId: string;
  displayName: string;
  nodeClass: NodeClass;
  dataType?: string;
  dataTypeId?: number;
  value?: any;
  accessLevel?: number;
  monitoredItem?: any;
  covLog?: string[];
}

export async function startTUI(endpoint: string): Promise<void> {
  const client = OPCUAClient.create({ endpointMustExist: false });

  let session: any;
  let subscription: ClientSubscription | null = null;
  let navigationHistory: string[] = ['RootFolder'];
  let currentNodeId = 'RootFolder';
  let currentItems: NodeInfo[] = [];
  let displayItems: NodeInfo[] = [];  // filtered view of currentItems
  let overlayOpen = false;            // write dialog is open
  let searchMode = false;             // search bar is active
  let searchQuery = '';
  let covNode: NodeInfo | null = null; // variable whose COV log is shown

  try {
    console.log(`Connecting to ${endpoint}...`);
    await client.connect(endpoint);
    session = await client.createSession();
    console.log('Connected. Starting TUI...');

    subscription = ClientSubscription.create(session, {
      requestedPublishingInterval: 1000,
      requestedLifetimeCount: 100,
      requestedMaxKeepAliveCount: 10,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 10,
    });

    // ── Widgets ───────────────────────────────────────────────────────────

    const screen = blessed.screen({ smartCSR: true, title: 'OPC-UA Browser' });

    const status = blessed.box({
      parent: screen, top: 0, left: 0, width: '100%', height: 1,
      tags: true,
      content: `Connected to ${endpoint} | RootFolder`,
      style: { bg: 'blue', fg: 'white' },
    });

    // Left pane: node tree (focused → cyan border, blurred → white)
    const list = blessed.list({
      parent: screen, top: 1, left: 0, width: '40%', height: '100%-3',
      border: 'line', label: ' Nodes ',
      style: {
        border: { fg: 'cyan' },
        selected: { bg: 'blue', fg: 'white' },
      },
      keys: true, vi: true,
      scrollbar: { ch: '│', style: { fg: 'blue' } },
    });

    // Right pane: details / COV log
    const details = blessed.box({
      parent: screen, top: 1, left: '40%', width: '60%', height: '100%-3',
      border: 'line', label: ' Details ',
      style: { border: { fg: 'white' } },
      scrollable: true, alwaysScroll: true,
      scrollbar: { ch: ' ', style: { bg: 'white' } },
    });

    // Search bar: appears between list and footer when search mode is active
    const searchBar = blessed.box({
      parent: screen, bottom: 1, left: 0, width: '40%', height: 1,
      tags: true,
      style: { bg: 'black', fg: 'yellow' },
      hidden: true,
    });

    const footer = blessed.box({
      parent: screen, bottom: 0, left: 0, width: '100%', height: 1,
      content: ' ↑↓: Navigate   Enter/→: Browse   ←/Bksp: Back   /: Search   q/Ctrl+C: Quit',
      style: { bg: 'black', fg: 'gray' },
    });

    // Write dialog
    const dialog = blessed.box({
      parent: screen, top: 'center', left: 'center', width: 62, height: 13,
      border: 'line', label: ' Write Value ',
      style: { border: { fg: 'yellow' }, bg: 'black' },
      hidden: true,
    });
    const dialogInfo = blessed.text({
      parent: dialog, top: 0, left: 1, width: '100%-4', height: 3,
      style: { fg: 'white', bg: 'black' },
    });
    const dialogInput = blessed.textbox({
      parent: dialog, top: 4, left: 1, width: '100%-4', height: 3,
      border: 'line', label: ' New Value ', inputOnFocus: true,
      style: {
        border: { fg: 'cyan' }, focus: { border: { fg: 'white' } },
        bg: 'black', fg: 'white',
      },
    });
    const dialogError = blessed.text({
      parent: dialog, top: 8, left: 1, width: '100%-4', height: 1,
      style: { fg: 'red', bg: 'black' },
    });
    blessed.text({
      parent: dialog, top: 9, left: 1, width: '100%-4', height: 1,
      content: 'Enter: Write   Esc: Cancel',
      style: { fg: 'gray', bg: 'black' },
    });

    // ── Helpers ───────────────────────────────────────────────────────────

    const setStatus = (msg: string, isError = false) => {
      status.setContent(isError ? `{red-fg}Error:{/red-fg} ${msg}` : msg);
      screen.render();
    };

    const updateHints = (node?: NodeInfo) => {
      if (searchMode) {
        footer.setContent(' Type to search   Enter: confirm   Esc: clear');
        return;
      }
      const isVariable = node?.nodeClass === NodeClass.Variable;
      const isWritable = isVariable && !!((node!.accessLevel ?? 0) & 2);
      const write = isWritable ? '   e: Write' : '';
      const cov = isVariable ? (covNode === node ? '   s: Hide log' : '   s: COV log') : '';
      const refresh = isVariable ? '   r: Refresh' : '';
      footer.setContent(` ↑↓: Navigate   Enter/→: Browse   ←/Bksp: Back${write}${cov}${refresh}   /: Search   q: Quit`);
    };

    const updateCovPanel = (node: NodeInfo) => {
      const log = node.covLog ?? [];
      details.setLabel(` COV — ${node.displayName || node.name} `);
      details.setContent(log.length > 0 ? log.join('\n') : '(no changes yet)');
      (details as any).scrollTo(log.length);
      screen.render();
    };

    const updateDetails = (node: NodeInfo) => {
      if (covNode === node) { updateCovPanel(node); return; }
      details.setLabel(' Details ');
      let content = `Node ID:      ${node.nodeId}\n`;
      content += `Browse Name:  ${node.name}\n`;
      content += `Display Name: ${node.displayName}\n`;
      content += `Node Class:   ${NodeClass[node.nodeClass]}\n`;
      if (node.nodeClass === NodeClass.Variable) {
        content += `Data Type:    ${node.dataType}\n`;
        content += `Value:        ${JSON.stringify(node.value, null, 2)}\n`;
        content += `Access Level: ${node.accessLevel}\n`;
        content += `Writable:     ${!!((node.accessLevel ?? 0) & 2)}\n`;
      }
      details.setContent(content);
      screen.render();
    };

    const applySearch = () => {
      const q = searchQuery.toLowerCase();
      displayItems = q
        ? currentItems.filter(n => (n.displayName || n.name).toLowerCase().includes(q))
        : [...currentItems];
      list.setItems(displayItems.map(n => n.displayName || n.name));
      searchBar.setContent(`{yellow-fg}/${searchQuery}{/yellow-fg}`);
      screen.render();
    };

    // ── Browse ────────────────────────────────────────────────────────────

    const browseChildren = async (nodeId: string): Promise<NodeInfo[]> => {
      const browseResult = await session.browse({
        nodeId,
        browseDirection: BrowseDirection.Forward,
        includeSubtypes: true,
        nodeClassMask: NodeClass.Object | NodeClass.Variable,
        resultMask: 0x3f,
      });

      const children: NodeInfo[] = [];
      for (const ref of browseResult.references || []) {
        const nodeInfo: NodeInfo = {
          name: ref.browseName.name,
          nodeId: ref.nodeId.toString(),
          displayName: ref.displayName.text,
          nodeClass: ref.nodeClass,
        };

        if (ref.nodeClass === NodeClass.Variable) {
          nodeInfo.covLog = [];
          try {
            const readResult = await session.read([
              { nodeId: ref.nodeId, attributeId: AttributeIds.DataType },
              { nodeId: ref.nodeId, attributeId: AttributeIds.Value },
              { nodeId: ref.nodeId, attributeId: AttributeIds.AccessLevel },
            ]);
            const dataTypeNodeId = readResult[0].value?.value;
            const dataTypeIdNum = dataTypeNodeId?.value as number;
            nodeInfo.dataTypeId = dataTypeIdNum;
            nodeInfo.dataType = DataType[dataTypeIdNum] || dataTypeNodeId?.toString();
            nodeInfo.value = readResult[1].value?.value;
            nodeInfo.accessLevel = readResult[2].value?.value;

            if (subscription) {
              const monitoredItem = await (subscription.monitor({
                nodeId: ref.nodeId,
                attributeId: AttributeIds.Value,
              }, {
                samplingInterval: 1000,
                discardOldest: true,
                queueSize: 10,
              }, TimestampsToReturn.Both) as Promise<ClientMonitoredItem>);

              monitoredItem.on('changed', (dataValue: DataValue) => {
                nodeInfo.value = dataValue.value.value;
                const ts = new Date().toISOString().substring(11, 23);
                nodeInfo.covLog!.push(`${ts}  ${JSON.stringify(nodeInfo.value)}`);
                if (nodeInfo.covLog!.length > 200) nodeInfo.covLog!.shift();

                const idx = (list as any).selected;
                if (idx >= 0 && displayItems[idx] === nodeInfo) {
                  updateDetails(nodeInfo);
                }
              });

              nodeInfo.monitoredItem = monitoredItem;
            }
          } catch {
            // ignore individual read errors
          }
        }
        children.push(nodeInfo);
      }
      return children;
    };

    // Load a node's children into the view (used for initial load + back nav)
    const loadLevel = async (nodeId: string, label: string) => {
      covNode = null;
      searchMode = false;
      searchQuery = '';
      searchBar.hide();
      list.setLabel(' Nodes (loading…) ');
      list.setItems(['Loading…']);
      screen.render();
      try {
        currentItems = await browseChildren(nodeId);
        displayItems = [...currentItems];
        list.setItems(displayItems.map(n => n.displayName || n.name));
        list.setLabel(' Nodes ');
        status.setContent(`Connected to ${endpoint} | ${label}`);
        details.setLabel(' Details ');
        details.setContent('');
        updateHints();
        screen.render();
      } catch (error) {
        list.setLabel(' Nodes ');
        setStatus(`Browse error: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    };

    // ── Write dialog ──────────────────────────────────────────────────────

    const editValue = (node: NodeInfo) => {
      if (node.nodeClass !== NodeClass.Variable || !((node.accessLevel ?? 0) & 2)) return;

      dialogInfo.setContent(
        `Node:      ${node.displayName}\n` +
        `Data Type: ${node.dataType ?? 'Unknown'}\n` +
        `Current:   ${JSON.stringify(node.value)}`
      );

      const attempt = (prefill: string, errorMsg = '') => {
        dialogError.setContent(errorMsg);
        dialogInput.setValue(prefill);
        overlayOpen = true;
        dialog.show();
        footer.setContent(' Enter: Write   Esc: Cancel');
        dialogInput.focus();
        screen.render();

        dialogInput.once('cancel', () => {
          overlayOpen = false;
          dialog.hide();
          list.focus();
          updateHints(node);
          screen.render();
        });

        dialogInput.once('submit', async (value: string) => {
          dialogInput.removeAllListeners('cancel');
          let parsed: any;
          try {
            parsed = JSON.parse(value);
          } catch {
            attempt(value, 'Invalid JSON — please correct and try again');
            return;
          }
          try {
            await session.write({
              nodeId: node.nodeId,
              attributeId: AttributeIds.Value,
              value: new DataValue({
                value: new Variant({ dataType: node.dataTypeId ?? DataType.Variant, value: parsed }),
              }),
            });
            node.value = parsed;
            updateDetails(node);
            overlayOpen = false;
            dialog.hide();
            list.focus();
            updateHints(node);
            screen.render();
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            attempt(value, `Write failed: ${msg}`);
          }
        });
      };

      attempt(JSON.stringify(node.value));
    };

    // ── Initial load ──────────────────────────────────────────────────────

    await loadLevel(currentNodeId, 'RootFolder');

    // ── Key bindings ──────────────────────────────────────────────────────

    // Navigate into selected node (Enter / →)
    const navigateInto = async () => {
      if (overlayOpen || searchMode) return;
      const idx = (list as any).selected;
      const selected = displayItems[idx];
      if (!selected) return;
      list.setLabel(' Nodes (loading…) ');
      list.setItems(['Loading…']);
      screen.render();
      try {
        const children = await browseChildren(selected.nodeId);
        if (children.length === 0) {
          // Leaf node — restore list and show details
          list.setLabel(' Nodes ');
          list.setItems(displayItems.map(n => n.displayName || n.name));
          screen.render();
          return;
        }
        navigationHistory.push(currentNodeId);
        currentNodeId = selected.nodeId;
        currentItems = children;
        displayItems = [...currentItems];
        covNode = null;
        list.setItems(displayItems.map(n => n.displayName || n.name));
        list.setLabel(' Nodes ');
        status.setContent(`Connected to ${endpoint} | ${selected.displayName || selected.name}`);
        details.setLabel(' Details ');
        details.setContent('');
        updateHints();
        screen.render();
      } catch (error) {
        list.setLabel(' Nodes ');
        list.setItems(displayItems.map(n => n.displayName || n.name));
        setStatus(`Browse error: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    };

    list.on('select', () => { navigateInto(); });
    screen.key(['right'], () => { navigateInto(); });

    // Back navigation (← / Backspace)
    screen.key(['left', 'backspace'], async () => {
      if (overlayOpen || searchMode) return;
      if (navigationHistory.length === 0) return;
      currentNodeId = navigationHistory.pop()!;
      const label = currentNodeId === 'RootFolder' ? 'RootFolder' : currentNodeId;
      await loadLevel(currentNodeId, label);
    });

    // Cursor move → update details + hints
    list.on('select item', (_item: any, index: number) => {
      if (overlayOpen) return;
      const selected = displayItems[index];
      if (selected) {
        updateDetails(selected);
        if (!searchMode) updateHints(selected);
        screen.render();
      }
    });

    // Write value
    screen.key(['e'], () => {
      if (overlayOpen || searchMode) return;
      const idx = (list as any).selected;
      if (idx >= 0) editValue(displayItems[idx]);
    });

    // Refresh (re-read) selected variable
    screen.key(['r'], async () => {
      if (overlayOpen || searchMode) return;
      const idx = (list as any).selected;
      const node = displayItems[idx];
      if (!node || node.nodeClass !== NodeClass.Variable) return;
      try {
        const readResult = await session.read([
          { nodeId: node.nodeId, attributeId: AttributeIds.DataType },
          { nodeId: node.nodeId, attributeId: AttributeIds.Value },
          { nodeId: node.nodeId, attributeId: AttributeIds.AccessLevel },
        ]);
        const dataTypeNodeId = readResult[0].value?.value;
        const dataTypeIdNum = dataTypeNodeId?.value as number;
        node.dataTypeId = dataTypeIdNum;
        node.dataType = DataType[dataTypeIdNum] || dataTypeNodeId?.toString();
        node.value = readResult[1].value?.value;
        node.accessLevel = readResult[2].value?.value;
        updateDetails(node);
      } catch (error) {
        setStatus(`Refresh error: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    });

    // COV log toggle
    screen.key(['s'], () => {
      if (overlayOpen || searchMode) return;
      const idx = (list as any).selected;
      const node = displayItems[idx];
      if (!node || node.nodeClass !== NodeClass.Variable) return;
      if (covNode === node) {
        covNode = null;
        details.setLabel(' Details ');
        updateDetails(node);
      } else {
        covNode = node;
        updateCovPanel(node);
      }
      updateHints(node);
      screen.render();
    });

    // Search: enter mode
    screen.key(['/'], () => {
      if (overlayOpen || searchMode) return;
      searchMode = true;
      searchQuery = '';
      applySearch();
      searchBar.show();
      updateHints();
      screen.render();
    });

    // Search: handle input
    screen.on('keypress', (ch: string, key: any) => {
      if (!searchMode) return;
      if (key.name === 'escape') {
        searchMode = false;
        searchQuery = '';
        displayItems = [...currentItems];
        list.setItems(displayItems.map(n => n.displayName || n.name));
        searchBar.hide();
        list.focus();
        const selected = displayItems[(list as any).selected];
        updateHints(selected);
        screen.render();
        return;
      }
      if (key.name === 'enter') {
        searchMode = false;
        searchBar.hide();
        list.focus();
        const selected = displayItems[(list as any).selected];
        updateHints(selected);
        screen.render();
        return;
      }
      if (key.name === 'backspace') {
        searchQuery = searchQuery.slice(0, -1);
        applySearch();
        return;
      }
      if (ch && ch.length === 1 && !key.ctrl && !key.meta) {
        searchQuery += ch;
        applySearch();
      }
    });

    // Focus/blur styling for list pane
    list.on('focus', () => {
      (list.style as any).border.fg = 'cyan';
      screen.render();
    });
    list.on('blur', () => {
      (list.style as any).border.fg = 'white';
      screen.render();
    });

    // Quit
    screen.key(['q', 'C-c'], async () => {
      if (overlayOpen || searchMode) return;
      if (subscription) await subscription.terminate();
      await session.close();
      await client.disconnect();
      process.exit(0);
    });

    list.focus();
    screen.render();

  } catch (error) {
    console.error('Error:', error);
    if (subscription) await subscription.terminate();
    if (session) await session.close();
    await client.disconnect();
    process.exit(1);
  }
}
