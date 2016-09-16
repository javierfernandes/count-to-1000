var fs = require('fs')
var commands = require("./commands.js")
var fn = require("./functions.js")
var path = require('path')
var activeCommands = 0
var resetWhenIdle = false
var SlackUpload = require('node-slack-upload');
// Slack only commands
commands.resetBot = {
    private: true,
    help: {
        description: "reinicia el bot",
        params: ["pass"],
        helpParams: {
            pass: "la contraseña"
        }
    },
    execute: function(params, then) {
        if (params.length < 1) {
            then({ success: false, text: "Falta contraseña" })
        }
        else if (params[0].trim() === pbotConfig.adminPassword) {
            resetWhenIdle = true
            then({ success: true, text: "Reset programado :)" })
        }
        else {
            then({ success: false, text: "Password inválida" })
        }
    }
}
var deleteFile = function(fileId, then) {
    var params = "&file=" + fileId;
    var deleteEndpoint = "https://slack.com/api/files.delete?token=" + apiToken + params;
    console.log ("deleting file ", fileId)
    request.post(deleteEndpoint, function (err, response, body) {
        then();
    });
};
var deleteMessage = function(timestamp, channelId, then) {
    var params = "&channel=" + channelId + "&ts=" + timestamp;
    var deleteEndpoint = "https://slack.com/api/chat.delete?token=" + apiToken + params;
    console.log ("deleting message ", timestamp, " from channel ", channelId);
    request.post(deleteEndpoint, function (err, response, body) {
        then();
    });
};
commands.purgeFiles = {
    private: true,
    help: {
        description: "borra los archivos subidos no compartidos, con reaction :x: o sin reactions."
    },
    execute: function(params, then) {
        var files = [];
        var fail = function (error) {
            then({ success: false, text: "Ocurrió un error: " + error });
        };
        var hasReaction = function(reactionsList, reactionName) {
            for (var i in reactionsList) {
                if (reactionsList[i].name === reactionName) {
                    return true;
                }
            }
            return false;
        };
        var purge = function () {
            if (files.length > 0) {
                var file = files[0];
                var shared = file.channels.length > 0 || file.groups.length > 0 || file.ims.length > 0;
                var markedWithReaction = hasReaction(file.reactions, "x");
                var hasReactions = file.reactions && file.reactions.length > 0;
                var shouldDelete = !shared || markedWithReaction || !hasReactions;
                if (shouldDelete) {
                    deleteFile(file.id, function () {
                        files = files.slice(1);
                        purge();
                    });
                }
                else {
                    files = files.slice(1);
                    purge();
                }
            }
            else {
                then({ success: true, text: "Archivos purgados." });
            }
        };
        var getFiles = function(userId, pageNumber, then) {
            var params = "&page=" + pageNumber + "&user=" + userId;
            var endpoint = "https://slack.com/api/files.list?token=" + apiToken + params;
            request.get(endpoint, function (err, response, body) {
                if (err) {
                    return then(err);
                }
                if (response.statusCode >= 300) {
                    return then(response);
                }
                body = JSON.parse(body);
                if (!body.ok) {
                    return then(body.error);
                }
                then(null, body, userId);
            });
        };
        var processFiles = function (error, body, userId) {
            if (body && body.ok) {
                files = files.concat(body.files);
                if (body.paging.page < body.paging.pages) {
                    getFiles(userId, body.paging.page + 1, processFiles);
                }
                else {
                    console.log("starting to delete files (", files.length, " total)");
                    purge();
                }
            }
            else {
                fail(error);
            }
        };
        request.get("https://slack.com/api/auth.test?token=" + apiToken, function (err, response, body) {
            if (err) {
                return fail(err);
            }
            if (response.statusCode >= 300) {
                return fail(response);
            }
            body = JSON.parse(body);
            if (!body.ok) {
                return fail(body.error);
            }
            getFiles(body.user_id, 1, processFiles);
        });
    }
}

commands.help.configure("uso command:[param1]+[param2]+...", function (commandName, description, params, command) {
    var note = ""
    if (command.private) {
        note = " (solo mensaje privado)"
    }
    return "`" + commandName + "`: " + description + note + "\n" + params + "\n"
}, function (paramName, description) {
    return "        `" + paramName + "` " + description + "\n"
})

var pbotConfig = JSON.parse(fs.readFileSync(__dirname + '/pbot.json', 'utf8'));

var WebSocket = require('ws'),
    apiToken = process.env.PBOT_APITOKEN || pbotConfig.apiToken,
    authUrl = "https://slack.com/api/rtm.start?token=" + apiToken,
    request = require("request");

request(authUrl, function(err, response, body) {
  if (!err && response.statusCode === 200) {
    var res = JSON.parse(body);
    if (res.ok) {
      connectWebSocket(res.url);
    }
  }
});

function connectWebSocket(url) {
  var ws = new WebSocket(url);

  ws.on('open', function() {
      console.log('Connected');
  });

  ws.on('message', function(message) {
      console.log('Received: ', message);
      message = JSON.parse(message);

      //if (isFaceUpload(message)) {
      //    controller.uploadFace(message, ws)
      //}

      var command = null
      var commandArgs = []
      var args, commandName
      if (message.type === 'message') {
        var text = message.text
        if ("file_share" === message.subtype) {
            text = message.file.title
            text += (text.indexOf(":") != -1 ? "+" : ":") + message.file.url_private_download
        }
        // command : param 
        args = /(\w*)\s*\:(.*)/.exec(text)
        if (args) {
          console.log("ARGS -> " + args)
          commandName = args[1].trim()
          commandArgs = fn.splitSlackParams(args[2])
          command = commands[commandName]
        }
        else if (text) {
          // command (?)
          command = commands[text.trim().replace(/\?/,'')]
        }
      }
      if (message.type === 'reaction_added' && message.reaction === 'x') {
          if (message.item.type === 'file') {
              deleteFile(message.item.file, function() {});
          }
          else if (message.item.type === 'message') {
              deleteMessage(message.item.ts, message.item.channel, function() {});
          }
      }
      if (command && availableForChannel(command, message.channel)) {
          sendStartTyping(ws, message)
          activeCommands++
          command.execute(commandArgs, function (response) {
            var end = function () {
              if (response.text) {
                sendMessage(ws, message.channel, text)
              }
              activeCommands--
              if (resetWhenIdle && activeCommands === 0) {
                ws.close()
              }
            }
            var text = "@bot: " + (response.text || "")
            if (response.attachments && response.attachments.length > 0) {
              var upload = function (i) {
                if (i === response.attachments.length) {
                  end()
                }
                else uploadAttachment(ws, response.attachments[i], message.channel, function () {
                  upload(i + 1)
                })
              }
              upload(0)
            }
            else {
              end()
            }
          })
      }
  });
}

function uploadAttachment(ws, attachment, channelId, then) {
    console.log("Uploading new image " + attachment.file + " ...");
    var url
    if (attachment.file.indexOf("http") === 0) {
        url = attachment.file
    }
    else if (pbotConfig.upload) {
        uploadFile(attachment.file, attachment.text, channelId, then)
    }
    else {
        var fileName = attachment.file.substring(attachment.file.lastIndexOf('/') + 1)
        url = pbotConfig.attachmentBaseUrl + attachment.file
        sendMessage(ws, channelId, attachment.text)
    }
    if (url) {
        sendMessage(ws, channelId, attachment.text + ": " + url)
        then()
    }
}

function uploadFile(fileName, text, channelId, then) {
  var slackUpload = new SlackUpload(apiToken)
  slackUpload.uploadFile({
    file: fs.createReadStream(fileName),
    title: text,
    channels: channelId
  }, function (err) {
    console.log("done! ", err);
  });
}

var uploadRegExp = /^uploadFace\:.*/

function isFaceUpload(message) {
  return (message.type === "file_created" ||
          message.type === "file_shared" ) && message.file.title.match(uploadRegExp)
}

var _nextId = 1
function nextId() {
	return _nextId++
}

function availableForChannel(command, channel) {
    return !command.private || channel.substring(0, 1) === "D"
}

function sendStartTyping(ws, message) {
    ws.send(JSON.stringify({
        channel: message.channel,
        id: nextId(),
        type: "typing",
        reply_to : message.id
    }));
}

 function sendMessage(ws, channelId, text) {
    ws.send(JSON.stringify({ 
        channel: channelId,
        id: nextId(),
        text: text,
        type: "message"
    }));
 }

 function sendDirectMessage(ws, to, text) {
    ws.send(JSON.stringify({ 
        channel: to, 
        id: 1,
        text: text,
        type: "message"
    }));
 }
