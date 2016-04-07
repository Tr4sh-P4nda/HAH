'use strict';

// don't pollute the global namespace
(function(exports)
{
	var socket;
	var turnOrder = [];
	var playerInfo = {};
	var hand = [];
	var blackCard = null;
	var czarId = '';

	function connectToGame(gameId)
	{
		// save player info
		if(altspace.inClient){
			altspace.getUser().then(function(userInfo)
			{
				playerInfo.id = userInfo.userId;
				playerInfo.displayName = userInfo.displayName;
			});
		}
		else {
			playerInfo.id = Math.round(Math.random()*0x8000);
			playerInfo.displayName = 'anon'+playerInfo.id;
		}

		// initialize the socket connection
		Game.socket = socket = io('/?gameId='+gameId);

		// debug listener
		var onevent = socket.onevent;
		socket.onevent = function(packet){
			var args = packet.data || [];
			onevent.call(this, packet);
			packet.data = ['*'].concat(args);
			onevent.call(this, packet);
		};
		socket.on('*', function(){
			console.log(arguments);
		});

		socket.on('error', function(msg){
			console.error(msg);
		});

		socket.on('init', init);

		socket.on('playerJoinRequest', playerJoinRequest);
		socket.on('playerJoin', playerJoin);
		socket.on('playerJoinDenied', playerJoinDenied);
		socket.on('playerLeave', playerLeave);
		socket.on('playerKickRequest', playerKickRequest);

		socket.on('dealCards', dealCards);
	}


	function emitPlayerJoinRequest(evt){
		socket.emit('playerJoinRequest', playerInfo.id, playerInfo.displayName);
	}

	function emitPlayerLeave(evt){
		socket.emit('playerLeave', playerInfo.id, playerInfo.displayName,
			playerInfo.displayName+' has left the game.'
		);
	}

	function init(newTurnOrder)
	{
		// generate seats for current players
		Utils.rebalanceTable(newTurnOrder, turnOrder);

		// save turn order (without reassigning obj)
		turnOrder.splice(0); turnOrder.push.apply(turnOrder, newTurnOrder);

		// deal placeholder cards to all players
		updateAllHands(turnOrder[0] && turnOrder[0].hand.length || 0);

		// hook up click-to-join handler
		gameObjects.box.removeEventListener('cursorup');
		gameObjects.box.addEventListener('cursorup', emitPlayerJoinRequest);

		//emitPlayerJoinRequest();
	}

	function playerJoinRequest(id, displayName)
	{
		var dialog = Utils.generateDialog('Can this player join?\n'+displayName,
			function(){
				socket.emit('playerJoin', id, displayName);
			},
			function(){
				socket.emit('playerJoinDenied', id, displayName);
			}
		);
		dialog.name = 'join_'+id;
		
		// auto-join
		//socket.emit('playerJoin', id, displayName);
	}

	function playerJoin(id, displayName, newTurnOrder)
	{
		Utils.rebalanceTable(newTurnOrder, turnOrder);
		turnOrder.splice(0); turnOrder.push.apply(turnOrder, newTurnOrder);

		if(id === playerInfo.id)
		{
			gameObjects.box.removeEventListener('cursorup');
			gameObjects.box.addEventListener('cursorup', function(){
				socket.emit('dealCards');
			});
			//socket.emit('dealCards');
		}

		// hide request dialog if present
		var seat = root.getObjectByName(playerInfo.id);
		if(seat)
		{
			var dialog;
			if(dialog = seat.getObjectByName('join_'+id)){
				seat.remove(dialog);
			}
		}

		console.log('New player joined:', displayName);
	}

	function playerJoinDenied(id, displayName)
	{
		// hide request dialog if present
		var seat = root.getObjectByName(playerInfo.id);
		var dialog;
		if(dialog = seat.getObjectByName('join_'+id)){
			seat.remove(dialog);
		}
	}

	function playerLeave(id, displayName, newTurnOrder)
	{
		Utils.rebalanceTable(newTurnOrder, turnOrder);
		turnOrder.splice(0); turnOrder.push.apply(turnOrder, newTurnOrder);

		if(id === playerInfo.id)
		{
			gameObjects.box.removeEventListener('cursorup');
			gameObjects.box.addEventListener(emitPlayerJoinRequest);

			root.traverse(function(model){
				if(model.name === 'nameplate'){
					model.removeEventListener('cursorup');
				}
			});
		}

		// hide request dialog if present
		var seat = root.getObjectByName(playerInfo.id);
		if(seat)
		{
			var dialog;
			if(dialog = seat.getObjectByName('kick_'+id)){
				seat.remove(dialog);
			}

		}

		console.log('Player', displayName, 'has left the game.');
	}

	function playerKickRequest(id, displayName)
	{
		if(id !== playerInfo.id){
			var dialog = Utils.generateDialog('Do you want to kick\n'+displayName+'?',
				function(){
					socket.emit('playerKickResponse', id, displayName, true);
				},
				function(){
					socket.emit('playerKickResponse', id, displayName, false);
				}
			);
			dialog.name = 'kick_'+id;
		}
	}


	function dealCards(newHand, newBlackCard, newCzarId)
	{
		blackCard = newBlackCard;
		blackCard.model = Utils.generateCard(blackCard.text.split('\n'), 'black');
		blackCard.model.applyMatrix( Utils.sphericalToMatrix(0, 0, 0.4, 'zyx') );

		// manage player hand
		if(Array.isArray(newHand)){
			updatePlayerHand(newHand, newCzarId);
		}

		// manage the placeholders that are everyone else's hands
		else
		{
			updateAllHands(newHand, newCzarId);
		}
	}

	function updatePlayerHand(newHand, newCzarId)
	{
		// set hand
		hand = newHand;

		var seat = root.getObjectByName(playerInfo.id);

		// build a list of card positions and their contents
		var cardRoots = [];
		var curCards = {};
		for(var temp=0; temp<12; temp++)
		{
			var cardRoot = seat.getObjectByName('card'+temp);
			if(cardRoot.children.length > 0){
				var child = cardRoot.children[0];
				curCards[child.userData.index] = child;
			}

			cardRoots.push(cardRoot);
		}

		// move things around to line up with the new hand
		for(var i=0; i<hand.length; i++)
		{
			// move cards that didn't change to new position
			if(curCards[hand[i].index])
			{
				// animate from old position to new position
				var oldPos = new THREE.Vector3().copy(curCards[hand[i].index].position);
				curCards[hand[i].index].localToWorld(oldPos);
				cardRoots[i].add(curCards[hand[i].index]);
				curCards[hand[i].index].worldToLocal(oldPos);
				curCards[hand[i].index].position.set(oldPos.x, oldPos.y, oldPos.z);
				curCards[hand[i].index].updateMatrix();

				carCards[hand[i].index].addBehavior(
					new Behaviors.Animate(new THREE.Vector3(0,0,0)) );
			}
			// generate new cards for those dealt this round
			else
			{
				var card = Utils.generateCard(hand[i].text.split('\n'), 'white');

				// animate from card box
				var boxPos = new THREE.Vector3().copy(gameObjects.box.position);
				root.localToWorld(boxPos);
				cardRoots[i].worldToLocal(boxPos);
				card.position.set(boxPos.x, boxPos.y, boxPos.z);
				card.updateMatrix();

				cardRoots[i].add(card);
				card.addBehavior( new Behaviors.Animate(new THREE.Vector3(0,0,0)) );
			}
		}

		// now hide hand if you're actually the czar this round
		if(playerInfo.id === newCzarId)
		{
			// hide hand
			for(var i=0; i<cardRoots.length; i++){
				cardRoots[i].visible = false;
			}

			// show black card
			seat.add(blackCard.model);
		}
		else
		{
			// show hand
			for(var i=0; i<cardRoots.length; i++){
				cardRoots[i].visible = true;
			}
		}
	}

	function updateAllHands(handLength, newCzarId)
	{
		// update scene for all other players
		for(var playerIdx=0; playerIdx<turnOrder.length; playerIdx++)
		{
			// skip self, already done
			var player = turnOrder[playerIdx];
			if(player.id === playerInfo.id)
				continue;

			var seat = root.getObjectByName(player.id);

			var cardRoots = [];
			for(var temp=0; temp<12; temp++){
				cardRoots.push(seat.getObjectByName('card'+temp));
			}

			// generate and place new cards
			for(var i=0; i<cardRoots.length; i++)
			{
				if(cardRoots[i].children.length === 0)
				{
					// steal from position 11 first
					if(handLength <= 10 && cardRoots[10].children.length > 0){
						cardRoots[i].add(cardRoots[10].children[0]);
					}
					// steal from position 12 next
					else if(handLength <= 10 && cardRoots[11].children.length > 0){
						cardRoots[i].add(cardRoots[11].children[0]);
					}
					// if those are empty, generate new card
					else if(i < handLength)
					{
						var card = Models.blankCard.clone();

						// animate from card box
						var boxPos = new THREE.Vector3().copy(gameObjects.box.position);
						root.localToWorld(boxPos);
						cardRoots[i].worldToLocal(boxPos);
						card.position.set(boxPos.x, boxPos.y, boxPos.z);
						card.updateMatrix();

						cardRoots[i].add(card);
						card.addBehavior( new Behaviors.Animate(new THREE.Vector3(0,0,0)) );
					}
				}
			}

			if(player.id === newCzarId)
			{
				// hide hand
				for(var i=0; i<cardRoots.length; i++){
					cardRoots[i].visible = false;
				}

				// show black card
				seat.add(blackCard.model);
			}
			else
			{
				// show hand
				for(var i=0; i<cardRoots.length; i++){
					cardRoots[i].visible = true;
				}
			}

		}
	}

	// export objects from scope
	exports.socket = socket;
	exports.turnOrder = turnOrder;
	exports.playerInfo = playerInfo;

	exports.connectToGame = connectToGame;

})(window.Game = window.Game || {});
