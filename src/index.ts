import {OpentokService} from './opentok.service';
import {filter, first, map, mergeMap, pluck, switchMap, switchMapTo, tap} from "rxjs/operators";
import {OtEventNames} from './opentok.model';
import * as OT from '@opentok/client';
import {merge, Observable} from "rxjs";
import {Signal, VideoMode} from "./live-session.model";
import data from './../secrets.json';

const otService = new OpentokService();
const initializedTokBoxSession = otService.initSession(data.apiKey, data.sessionId);
let coachAudioStreamSubscription: OT.Subscriber;
let coachAudioStreamBlocked$: Observable<OT.Event<any, any>>;


const connectSession = initializedTokBoxSession.pipe(
  switchMapTo(otService.connectSession(data.token)),
);

const initPublisherAndPublishToStream = otService
  .sessionMediaInitPublisher('ai-member-audio', {
    fitMode: 'contain',
    height: 0,
    insertMode: 'append',
    mirror: false,
    publishAudio: true,
    publishVideo: false,
    style: {
      buttonDisplayMode: 'off',
    },
    videoSource: null,
    width: 0,
  }).pipe(
    switchMap(publisher => otService.publishMediaToStream(publisher))
  );

function subscribeCoachAudioFeed(stream: OT.Stream): void {
  otService
    .sessionMediaSubscribe('ao-coach-generic', stream, {
      height: 0,
      insertMode: 'append',
      showControls: false,
      subscribeToAudio: true,
      subscribeToVideo: false,
      width: 0,
    })
    .pipe(
      // tslint:disable:no-console
      filter((otSubscription) => !!otSubscription),
      tap((otSubscription) => {
        coachAudioStreamBlocked$ = new Observable((observer) => {
          otSubscription.on(
            `${OtEventNames.AudioBlocked} ${OtEventNames.AudioUnBlocked}`,
            (event: OT.Event<OtEventNames.AudioBlocked | OtEventNames.AudioUnBlocked, OT.Stream>) =>
              observer.next(event)
          );
        });
      }),
      tap(() =>
        otService.sendSessionSignal({
          type: Signal.StageRequestCanceled,
          data: otService.connectionId,
        })
      )
    )
    .subscribe({
      next: () => {
        console.log('Success, Coach Audio Subscription')
      },
      error: (err) => {
        console.log('Error, Coach Audio Subscription: ', err.message);
      },
    });
}

connectSession.pipe(
  switchMapTo(initPublisherAndPublishToStream)
).subscribe(
  {
    next: () => console.log('Success publishToStream'),
    error: e => console.log('Fail publishToStream', e),
  }
)

otService.coachStreamLifecycleEvents$.pipe(
  filter(event => event.type === OtEventNames.StreamCreated),
  // @ts-ignore event any error - naz fix this
  switchMap(event => otService.sessionMediaSubscribe('camera-outlet', event['stream'], {
    fitMode: 'contain',
    height: '500px',
    insertMode: 'append',
    showControls: false,
    subscribeToAudio: false,
    subscribeToVideo: true,
    width: '800px',
  }))
).subscribe({
  next: n => console.log('Connect to coach video - success', n),
  error: e => console.log('Connect to coach video - fail', e),
});

// @ts-ignore
/**
 * Handle Audio Switching from various audio stream sources
 * Must be subscribed after the view initializes because we need a references to elements on the page.
 */
merge(
  otService.sessionConnectionLifecycleEvents$.pipe(
    first(),
    map((event) =>
      event['target']['streams'].find(
        (s: OT.Stream) => otService.isCoachConnection(s['connection']) && s?.videoType !== VideoMode.Screen
      )
    ),
  ),
  otService.coachStreamLifecycleEvents$.pipe(
    // @ts-ignore event any error - naz fix this
    filter((event: OT.Event<any, any>) => event.type === OtEventNames.StreamCreated && event['stream'].videoType !== VideoMode.Screen),
    pluck('stream'),
  )
)
  .pipe(
    filter((s) => !!s),
    filter((s) => {
      if (!coachAudioStreamSubscription) {
        return true;
      } else {
        // @ts-ignore event any error - naz fix this
        return s.id !== coachAudioStreamSubscription['streamId'];
      }
    })
  )
  .subscribe((stream) => subscribeCoachAudioFeed(stream));

/**
 * Subscribes to the audio stream generated by members joining the session.
 * Must be subscribed after the view initializes because we need a references to elements on the page.
 */
otService.memberStreamLifecycleEvents$
  .pipe(
    // takeUntil(this.destroy$),
    tap((_) => console.log('memberStreamLifecycleEvents$ pre filter', _)),
    filter((event) => event.type === OtEventNames.StreamCreated),
    tap((_) => console.log('memberStreamLifecycleEvents$ post filter', _)),
    mergeMap((event) =>
      otService
        // @ts-ignore event any error - naz fix this
        .sessionMediaSubscribe('ao-member-audio', event['stream'], {
          insertMode: 'append',
          subscribeToAudio: true,
          subscribeToVideo: false,
        })
    )
  )
  .subscribe({
    next: s => console.log('Subscribe to other members audio - success', s),
    error: e => console.error('Subscribe to other members audio - fail', e),
  });
