import { useState, useEffect, useContext } from 'react'
import { HypermergeUrl, parseDocumentLink, createDocumentLink, PushpinUrl } from './ShareLink'
import { useTimeouts, useMessaging, useRepo, useSelfId, useDocument, useSelf } from './Hooks'
import { CurrentDeviceContext } from './components/content-types/workspace/Device'
import { ContactDoc } from './components/content-types/contact'

/**
 * heartbeats are an accumulated list of the URLs we have "open" and so should
 * report heartbeats (and forward our "presence data") to.
 */
const heartbeats: { [url: string]: number } = {} // url: HypermergeUrl

/**
 * myPresence is the data (per-url) that we send to our peers
 */
const myPresence: { [url: string /* HypermergeUrl */]: { [key: string]: any } } = {}

const HEARTBEAT_INTERVAL = 5000 // ms

export interface RemotePresence<P> {
  contact: HypermergeUrl
  device: HypermergeUrl
  data?: P
}

export interface RemotePresenceCache<P> {
  [contactAndDevice: string]: RemotePresence<P>
}

interface HeartbeatMessage {
  contact: HypermergeUrl
  device: HypermergeUrl
  heartbeat?: boolean
  departing?: boolean
  data?: any
}

/**
 * Send all the heartbeats associated with every document
 * @param contact: (selfId HypermergeUrl)
 */
export function useAllHeartbeats(contact: HypermergeUrl | null) {
  const repo = useRepo()
  const currentDeviceId = useContext(CurrentDeviceContext)
  const parsed = currentDeviceId && parseDocumentLink(currentDeviceId)
  const device = (parsed && parsed.hypermergeUrl) || null

  useEffect(() => {
    if (!contact) {
      return () => {}
    }
    if (!device) {
      return () => {}
    }

    const interval = setInterval(() => {
      // Post a presence heartbeat on documents currently considered
      // to be open, allowing any kind of card to render a list of "present" folks.
      Object.entries(heartbeats).forEach(([url, count]) => {
        if (count > 0) {
          const msg: HeartbeatMessage = {
            contact,
            device,
            heartbeat: true,
            data: myPresence[url],
          }
          // we can't use HypermergeUrl as a key in heartbeats, so we do this bad thing
          repo.message(url as HypermergeUrl, msg)
        } else {
          depart(url as HypermergeUrl)
          delete heartbeats[url]
        }
      })
    }, HEARTBEAT_INTERVAL)

    function depart(url: HypermergeUrl) {
      if (!contact || !device) {
        return
      }
      const departMessage: HeartbeatMessage = {
        contact,
        device,
        departing: true,
      }
      repo.message(url, departMessage)
    }

    return () => {
      clearInterval(interval)
      // heartbeats can't have HypermergeUrls as keys, so we do this
      Object.entries(heartbeats).forEach(([url]) => depart(url as HypermergeUrl))
    }
  }, [contact, device, repo])
}

export function useHeartbeat(docUrl: HypermergeUrl | null) {
  useEffect(() => {
    if (!docUrl) {
      return () => {}
    }

    heartbeats[docUrl] = (heartbeats[docUrl] || 0) + 1

    return () => {
      heartbeats[docUrl] && (heartbeats[docUrl] -= 1)
    }
  }, [docUrl])
}

function remotePresenceToLookupKey<T>(presence: RemotePresence<T>): string {
  return `${presence.contact}-${presence.device}`
}
function lookupKeyToPresencePieces(key: string): [HypermergeUrl, HypermergeUrl] {
  const [contact, device] = key.split('-')
  return [contact as HypermergeUrl, device as HypermergeUrl]
}

export function usePresence<P>(
  url: HypermergeUrl | null,
  presence?: P,
  key: string = '/'
): RemotePresence<P>[] {
  const [remote, setRemoteInner] = useState<RemotePresenceCache<P>>({})
  const setSingleRemote = (presence: RemotePresence<P>) => {
    setRemoteInner((prev) => ({
      ...prev,
      [remotePresenceToLookupKey(presence)]: { ...presence },
    }))
  }
  const [bumpTimeout, depart] = useTimeouts(HEARTBEAT_INTERVAL * 2, (key: string) => {
    const [contact, device] = lookupKeyToPresencePieces(key)
    setSingleRemote({ contact, device, data: undefined })
  })

  useMessaging<any>(url, (msg: HeartbeatMessage) => {
    const { contact, device, heartbeat, departing, data } = msg
    const presence = { contact, device, data }
    if (heartbeat || data !== undefined) {
      bumpTimeout(remotePresenceToLookupKey(presence))
      setSingleRemote(presence)
    } else if (departing) {
      depart(remotePresenceToLookupKey(presence))
    }
  })

  useEffect(() => {
    if (!url || !key) return () => {}

    if (!myPresence[url]) {
      myPresence[url] = {}
    }

    if (presence === undefined) {
      delete myPresence[url][key]
    } else {
      myPresence[url][key] = presence
    }

    return () => {
      delete myPresence[url][key]
    }
  }, [key, presence, url])

  return Object.values(remote)
    .filter((presence) => presence.data)
    .map((presence) => ({ ...presence, data: presence.data![key] }))
}

/**
 * For a given contact, return the device urls (as pushpin urls) which are online
 * devices for that context. Will return an empty array if no device is online for the contact.
 * If the contact is self (the current user), the current device will be listed first.
 */
export function useOnlineDevicesForContact(contactId: HypermergeUrl | null): PushpinUrl[] {
  const selfId = useSelfId()
  const selfDeviceUrl = useContext(CurrentDeviceContext)

  const onlineRemotes = usePresence(contactId).filter((p) => p.contact === contactId)
  const remoteDevices = onlineRemotes.map((presence) =>
    createDocumentLink('device', presence.device)
  )

  if (selfId === contactId && selfDeviceUrl) {
    remoteDevices.unshift(selfDeviceUrl)
  }
  return remoteDevices
}

export function useContactOnlineStatus(contactId: HypermergeUrl | null): boolean {
  const selfId = useSelfId()
  const presence = usePresence(contactId, {}, 'onlineStatus')
  return selfId === contactId || presence.some((p) => p.contact === contactId)
}

/**
 * For a given device, return whether or not the device is online.
 * If the passed device is the current device, always returns true.
 */
export function useDeviceOnlineStatus(deviceId: HypermergeUrl | null): boolean {
  const currentDeviceUrl = useContext(CurrentDeviceContext)
  const isCurrentDevice =
    currentDeviceUrl && parseDocumentLink(currentDeviceUrl).hypermergeUrl === deviceId
  const presence = usePresence(deviceId, {}, 'onlineStatus')
  return isCurrentDevice || presence.some((p) => p.device === deviceId)
}

type NotConnected = 'not-connected' // There are other devices to connect to, and connected to at least one.
type NoDevices = 'self-no-devices' // No other devices are available to connect to.
type Unreachable = 'self-unreachable' // There are other devices to connect to, but not connected to any of them.
type Connected = 'connected' // There are other devices to connect to, and connected to at least one.
type ConnectionStatus = NotConnected | NoDevices | Unreachable | Connected
export function useConnectionStatus(contactId: HypermergeUrl | null): ConnectionStatus {
  const [contact] = useDocument<ContactDoc>(contactId)
  const selfId = useSelfId()
  const onlineDevices = useOnlineDevicesForContact(contactId)
  if (selfId !== contactId) {
    return onlineDevices.length > 0 ? 'connected' : 'not-connected'
  }

  if (!contact || !contact.devices || contact.devices.length <= 1) return 'self-no-devices'

  return onlineDevices.length > 1 ? 'connected' : 'self-unreachable'
}
