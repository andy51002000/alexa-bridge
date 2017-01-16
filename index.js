"use strict";

var nconf = require('nconf');
var crypto = require('crypto');
var restify = require('restify');
var directLine = require('./lib/directLine.js');

// Required to make rxjs ajax run browser-less
global.XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

var config = nconf.argv().env().file({ file: 'localConfig.json' });

var responses = {};
var botId = config.get('botId');

function sendReply(replyToId) {

  var res_next = responses[replyToId];
  var res = res_next[0]; 
  var next = res_next[1];
  var reply = res_next[2];
  delete responses[replyToId];

  res.send(reply);
  next();
}

function botSays(activity) {

  // We see all messages to the conversation forcing us to screen
  // the client originated ones and only complete only the bot's 
  // replies to previous requests
  
  if (activity.from.id == botId && activity.replyToId) {

    var reply = { 
      "version": "1.0",
      "response": {
        "outputSpeech": {
          "type": "PlainText",
          "text": activity.text
        }
      }
    };

    if (activity.replyToId in responses) {
      responses[activity.replyToId].push(reply);
      sendReply(activity.replyToId);
    }
    else {
      responses[activity.replyToId] = [reply];
    }
  }
}

function alexaSays(req, res, bot, next) {
  
  // Alexa is calling us with the utterance

  var userId = req.body.session.user.userId;
  var requestId = req.body.request.requestId;
  var utterance = req.body.request.intent.slots.phrase.value;

  // Bot SDK seems to have some hidden rules regarding valid userId
  // so doing this works around those (else we get 400's)
  userId = crypto.createHmac('md5', userId).digest('hex');
  requestId = userId + crypto.createHmac('md5', requestId).digest('hex');

  var activity = {
    type : "message",
    text : utterance,
    from : { id : userId },
    locale : "en-US",
    timestamp : (new Date()).toISOString()
  };

  //responses[id] = [ res, next ];

  // Forward the activity to our Bot
  bot.postActivity(activity)
  .subscribe(id => {
    if (id != 'retry') {
      if (id in responses) {
        responses[id].unshift(next);
        responses[id].unshift(res);
        sendReply(id);
      }
      else {
        responses[id] = [res, next];
      }
    }
  }, error => {
    console.warn("failed to send postBack", error);
  });
}

function startBridge() {

  var opts = { secret : config.get('directLineSecret') };
  var connector = new directLine.DirectLine(opts);
 
  connector.activity$.subscribe(
    botSays,
    error => console.log("activity$ error", error)
  );

  var server = restify.createServer();
  server.use(restify.bodyParser());
  server.post('/messages', (req, res, err) => alexaSays(req, res, connector, err) );

  server.listen(8080, function() {
    console.log('%s listening at %s', server.name, server.url);
  });
}

function main() {
  startBridge();
}

if (require.main === module) {
  main();
}
