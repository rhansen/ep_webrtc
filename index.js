// TODO - test on Firefox as well
// TODO - figure out weird glitchy sizing thing on startup. seems to just be when video.enabled is false. test that alone on master. if it still happens, ship it.
// vim: et:ts=2:sw=2:sts=2:ft=javascript
/**
 * Copyright 2013 j <j@mailb.org>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var log4js = require('ep_etherpad-lite/node_modules/log4js')
var statsLogger = log4js.getLogger("stats");
var eejs = require('ep_etherpad-lite/node/eejs/');
var settings = require('ep_etherpad-lite/node/utils/Settings');
var sessioninfos = require('ep_etherpad-lite/node/handler/PadMessageHandler').sessioninfos;
var stats = require('ep_etherpad-lite/node/stats')
var socketio;

/**
 * Handles an RTC Message
 * @param client the client that send this message
 * @param message the message from the client
 */
function handleRTCMessage(client, payload)
{
  var userId = sessioninfos[client.id].author;
  var to = payload.to;
  var padId = sessioninfos[client.id].padId;
  var room = socketio.sockets.adapter.rooms[padId];
  var clients = [];

  if (room && room.sockets) {
    for (var id in room.sockets) {
      clients.push(socketio.sockets.sockets[id]);
    }
  }

  var msg = {
    type: "COLLABROOM",
    data: {
      type: "RTC_MESSAGE",
      payload: {
        from: userId,
        data: payload.data
      }
    }
  };
  // Lookup recipient and send message
  for(var i = 0; i < clients.length; i++) {
    var session = sessioninfos[clients[i].id];
    if(session && session.author == to) {
      clients[i].json.send(msg);
      break;
    }
  }
}

// Make sure any updates to this are reflected in README
const statErrorNames = [
  "Abort",
  "Hardware",
  "NotFound",
  "NotSupported",
  "Permission",
  "SecureConnection",
  "Unknown"
]

function handleErrorStatMessage(statName) {
  if (statErrorNames.indexOf(statName) !== -1) {
    stats.meter("ep_webrtc_err_" + statName).mark();
  } else {
    statsLogger.warn("Invalid ep_webrtc error stat: " + statName);
  }
}

getDisabledDefault = function(field)
{
  // TODO - have a settings.json.template type thing
  if (settings.ep_webrtc) {
    if (settings.ep_webrtc[field] === "disabled") {
      // defaultOn should be ignored in this case
      return {enabled: false}
    } else if (settings.ep_webrtc[field] === "default_off") {
      return {enabled: true, defaultOn: false}
    } else if (settings.ep_webrtc[field] === "default_on" || settings.ep_webrtc[field] === undefined) {
      return {enabled: true, defaultOn: true}
    } else {
      // TODO - useless since you can change it in the admin?
      throw Error("invalid value for setting ep_webrtc." + field + ": " + settings.ep_webrtc[field])
    }
  }
}

exports.clientVars = function(hook, context, callback)
{
  var enabled = true;
  if(settings.ep_webrtc && settings.ep_webrtc.enabled === false){
    enabled = settings.ep_webrtc.enabled;
  }

  audio = getDisabledDefault('audio');
  video = getDisabledDefault('video');

  var iceServers = [ {"url": "stun:stun.l.google.com:19302"} ];
  if(settings.ep_webrtc && settings.ep_webrtc.iceServers){
    iceServers = settings.ep_webrtc.iceServers;
  }

  var listenClass = false;
  if(settings.ep_webrtc && settings.ep_webrtc.listenClass){
    listenClass = settings.ep_webrtc.listenClass;
  }

  var video = {sizes: {}};
  if(settings.ep_webrtc && settings.ep_webrtc.video && settings.ep_webrtc.video.sizes) {
    video.sizes = {
      large: settings.ep_webrtc.video.sizes.large,
      small: settings.ep_webrtc.video.sizes.small
    }
  }

  return callback({
    webrtc: {
      "iceServers": iceServers,
      "enabled": enabled,
      // TODO - I need to rename audio_enabled/video_enabled. "enabled" means something different than audioTrack.enabled
      "audio_enabled": audio.enabled,
      "audio_default_on": audio.defaultOn,
      "listenClass": listenClass,
      "video": video
    }
  });
};

exports.handleMessage = function ( hook, context, callback )
{
  if (context.message.type == 'COLLABROOM' && context.message.data.type == 'RTC_MESSAGE') {
    handleRTCMessage(context.client, context.message.data.payload);
    callback([null]);
  } else if (context.message.type == 'STATS' && context.message.data.type == 'RTC_MESSAGE') {
    handleErrorStatMessage(context.message.data.statName);
    callback([null]);
  } else {
    callback();
  }
};

exports.setSocketIO = function (hook, context, callback)
{
  socketio = context.io;
  callback();
};

exports.eejsBlock_mySettings = function (hook, context, callback)
{
    // TODO - Double check this still works. Don't rely on the javascript
    var enabled = (settings.ep_webrtc && settings.ep_webrtc.enabled === false)
      ? 'unchecked'
      : 'checked';

    var audioEnabled = (settings.ep_webrtc && settings.ep_webrtc.audio !== "disabled")
      ? true
      : false;

    var videoEnabled = (settings.ep_webrtc && settings.ep_webrtc.video !== "disabled")
      ? true
      : false;

    context.content += eejs.require('ep_webrtc/templates/settings.ejs', {
      enabled : enabled,
      audio_enabled : audioEnabled,
      video_enabled : videoEnabled,
    });
    callback();
};

exports.eejsBlock_editorContainerBox = function (hook_name, args, cb) {
  args.content = args.content + eejs.require("ep_webrtc/templates/webrtc.ejs", {}, module);
  return cb();
}

exports.eejsBlock_styles = function (hook_name, args, cb) {
  args.content = args.content + eejs.require("ep_webrtc/templates/styles.html", {}, module);
  return cb();
};
