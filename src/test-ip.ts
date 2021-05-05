import { Handler, APIGatewayEvent } from 'aws-lambda';

const handler: Handler = async (event: APIGatewayEvent) => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': `text/html` },
    body: `<h1>Your IP address is: <code>${event.headers[`client-ip`]}</code></h1>`,
  };
};

export { handler };
