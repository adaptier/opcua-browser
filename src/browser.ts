import { OPCUAClient, BrowseDirection, NodeClass, AttributeIds, DataType } from 'node-opcua';

export async function browseServer(endpoint: string): Promise<void> {
  const client = OPCUAClient.create({
    endpointMustExist: false,
  });

  try {
    console.log(`Connecting to ${endpoint}...`);
    await client.connect(endpoint);
    console.log('Connected successfully.');

    const session = await client.createSession();
    console.log('Session created.');

    // Browse root folder
    const browseResult = await session.browse({
      nodeId: 'RootFolder',
      browseDirection: BrowseDirection.Forward,
      includeSubtypes: true,
      nodeClassMask: NodeClass.Object | NodeClass.Variable,
      resultMask: 0x3f,
    });

    console.log('\nRoot Folder Contents:');
    for (const reference of browseResult.references || []) {
      console.log(`\n--- Node: ${reference.browseName.name} ---`);
      console.log(`Node ID: ${reference.nodeId.toString()}`);
      console.log(`Browse Name: ${reference.browseName.name}`);
      console.log(`Display Name: ${reference.displayName.text}`);
      console.log(`Node Class: ${NodeClass[reference.nodeClass]}`);

      if (reference.nodeClass === NodeClass.Variable) {
        // Read variable attributes
        try {
          const readResult = await session.read([
            { nodeId: reference.nodeId, attributeId: AttributeIds.DataType },
            { nodeId: reference.nodeId, attributeId: AttributeIds.Value },
            { nodeId: reference.nodeId, attributeId: AttributeIds.AccessLevel },
          ]);

          const dataType = readResult[0].value?.value;
          const value = readResult[1].value?.value;
          const accessLevel = readResult[2].value?.value;

          console.log(`Data Type: ${DataType[dataType] || dataType}`);
          console.log(`Value: ${JSON.stringify(value)}`);
          console.log(`Access Level: ${accessLevel}`);
        } catch (error) {
          console.log('Error reading variable attributes:', error instanceof Error ? error.message : String(error));
        }
      }
    }

    await session.close();
    await client.disconnect();
    console.log('Disconnected.');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}